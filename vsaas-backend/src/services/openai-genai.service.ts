/**
 * OpenAI GenAI Service — alternativa ao genai.service.ts (Google Gemini).
 *
 * Implementa as mesmas funções públicas (`describeEvent`, `readPlate`,
 * `classifyFalsePositive`) mas usando GPT-4o-mini com vision. Selecionado
 * via env `LLM_PROVIDER=openai` (wrapper em llm-provider.ts).
 *
 * Por que mini:
 *  - Custo: $0.15/M input, $0.60/M output (vs Gemini Pro $1.25/$5)
 *  - Latência similar
 *  - Vision quality boa pra describe de cena CFTV
 *  - Estructured outputs via response_format json_schema (strict)
 *
 * API key: lida de OPENAI_API_KEY (env) ou /run/secrets/openai_api_key.
 *
 * Ver docs/semantic-search/ e LLM_PROVIDER env.
 */
import fs from 'node:fs'
import OpenAI from 'openai'
import { logger } from '../lib/logger'
import {
  type DescribeResult,
  type PlateOCRResult,
  type FalsePositiveResult,
  type SemanticEvalResult,
} from './genai.service'

// ─── Config ─────────────────────────────────────────────────────────────────

const MODEL_VISION = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini'
const MAX_RETRIES  = 2
const BACKOFF_MS   = 800

function readApiKey(): string {
  const env = process.env.OPENAI_API_KEY?.trim()
  if (env) return env
  try { return fs.readFileSync('/run/secrets/openai_api_key', 'utf-8').trim() }
  catch { return '' }
}

let _client: OpenAI | null = null
function getClient(): OpenAI | null {
  if (_client) return _client
  const key = readApiKey()
  if (!key) return null
  _client = new OpenAI({ apiKey: key })
  return _client
}

export const openaiGenaiAvailable = () => getClient() !== null

// ─── Retry helper ───────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>): Promise<T | null> {
  let lastErr: any
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try { return await fn() }
    catch (err: any) {
      lastErr = err
      const status = err?.status ?? err?.response?.status
      const retriable = status === 429 || (typeof status === 'number' && status >= 500)
      if (!retriable || attempt === MAX_RETRIES) {
        logger.warn({ attempt, status, msg: err?.message }, 'openai_call_failed')
        return null
      }
      await new Promise(r => setTimeout(r, BACKOFF_MS * Math.pow(2, attempt - 1)))
    }
  }
  logger.warn({ lastErr: String(lastErr) }, 'openai_call_exhausted')
  return null
}

function toImageUrl(buf: Buffer): string {
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

// ─── describeEvent ──────────────────────────────────────────────────────────

const DESCRIBE_SYSTEM = `Você é um analista de vigilância CFTV.
Analise estas imagens de uma câmera de segurança e extraia informações estruturadas em PT-BR.
Seja factual, conciso e específico. Foco: pessoas (vestimenta, acessórios), veículos
(tipo, cor, placa se legível), ações observáveis, objetos sendo carregados.
NÃO especule emoções ou intenções.

REGRAS DE TAGS (campo tags, multi-label, 0..N):
- "pessoa": há ≥1 pessoa visível na cena
- "veiculo": há ≥1 veículo (carro, moto, caminhão, ônibus, bicicleta)
- "objeto_abandonado": objeto parado isolado sem dono aparente por tempo notável
- "epi_violacao": pessoa em ambiente que requer EPI (capacete, colete, máscara) está sem
- "aglomeracao": ≥5 pessoas próximas
- "comportamento_anomalo": queda, briga, corrida fora de contexto, escalada
- "noturno": cena claramente noturna (pouca luz, IR ativo)
- "chuva_neblina": condição visual degradada por chuva/neblina/poeira

Vazio se nenhuma aplicar.`

const DESCRIBE_SCHEMA = {
  name: 'cctv_describe',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      description: { type: 'string' },
      attributes: {
        type: 'object',
        additionalProperties: false,
        properties: {
          people: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                clothing_top:    { type: ['string', 'null'] },
                clothing_bottom: { type: ['string', 'null'] },
                hair:            { type: ['string', 'null'] },
                accessories:     { type: 'array', items: { type: 'string' } },
              },
              required: ['clothing_top', 'clothing_bottom', 'hair', 'accessories'],
            },
          },
          vehicles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                type:  { type: ['string', 'null'] },
                color: { type: ['string', 'null'] },
                plate: { type: ['string', 'null'] },
              },
              required: ['type', 'color', 'plate'],
            },
          },
          actions:       { type: 'array', items: { type: 'string' } },
          items_carried: { type: 'array', items: { type: 'string' } },
          scene_notes:   { type: ['string', 'null'] },
        },
        required: ['people', 'vehicles', 'actions', 'items_carried', 'scene_notes'],
      },
      tags: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'pessoa', 'veiculo', 'objeto_abandonado', 'epi_violacao',
            'aglomeracao', 'comportamento_anomalo', 'noturno', 'chuva_neblina',
          ],
        },
      },
    },
    required: ['description', 'attributes', 'tags'],
  },
} as const

export async function describeEventOpenAI(
  jpegBuffers: Buffer[],
  objectType: string,
): Promise<DescribeResult | null> {
  const client = getClient()
  if (!client || jpegBuffers.length === 0) return null

  const frames = jpegBuffers.slice(0, 3)
  const hint = frames.length > 1
    ? `Foram capturadas ${frames.length} imagens sequenciais do mesmo evento. Descreva considerando a AÇÃO ao longo do tempo.`
    : `Imagem única do evento. Descreva o que vê.`

  const raw = await withRetry(async () => {
    const r = await client.chat.completions.create({
      model: MODEL_VISION,
      messages: [
        { role: 'system', content: DESCRIBE_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Objeto detectado pelo YOLO: ${objectType}\n${hint}` },
            ...frames.map(buf => ({
              type: 'image_url' as const,
              image_url: { url: toImageUrl(buf), detail: 'low' as const },
            })),
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: DESCRIBE_SCHEMA as any },
      max_completion_tokens: 600,
    })
    return r.choices[0]?.message?.content ?? null
  })

  if (!raw) return null
  try {
    return JSON.parse(raw) as DescribeResult
  } catch (e: any) {
    logger.warn({ raw: raw.slice(0, 200), err: e.message }, 'openai_describe_invalid_json')
    return null
  }
}

// ─── readPlate ──────────────────────────────────────────────────────────────

const PLATE_SCHEMA = {
  name: 'plate_ocr',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      plate_text:    { type: 'string' },
      confidence:    { type: 'number' },
      vehicle_type:  { type: 'string' },
      vehicle_color: { type: 'string' },
      reason:        { type: 'string' },
    },
    required: ['plate_text', 'confidence', 'vehicle_type', 'vehicle_color', 'reason'],
  },
} as const

const PLATE_SYSTEM = `Você é um especialista em LPR (License Plate Recognition) brasileiro.
Identifique a placa do veículo nesta imagem (padrão antigo ABC1234 OU Mercosul ABC1A23).
Se a placa não estiver legível, retorne plate_text="" e explique em reason.
Identifique também tipo (car/motorcycle/truck/bus) e cor do veículo.
confidence é 0-1.`

export async function readPlateOpenAI(jpeg: Buffer): Promise<PlateOCRResult | null> {
  const client = getClient()
  if (!client) return null

  const raw = await withRetry(async () => {
    const r = await client.chat.completions.create({
      model: MODEL_VISION,
      messages: [
        { role: 'system', content: PLATE_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Leia a placa, tipo e cor do veículo nesta imagem.' },
            { type: 'image_url', image_url: { url: toImageUrl(jpeg), detail: 'high' } },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: PLATE_SCHEMA as any },
      max_completion_tokens: 300,
    })
    return r.choices[0]?.message?.content ?? null
  })

  if (!raw) return null
  try { return JSON.parse(raw) as PlateOCRResult }
  catch { return null }
}

// ─── classifyFalsePositive ──────────────────────────────────────────────────

const FP_SCHEMA = {
  name: 'fp_classifier',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      is_real:           { type: 'boolean' },
      what_it_is_really: { type: 'string' },
      reason:            { type: 'string' },
    },
    required: ['is_real', 'what_it_is_really', 'reason'],
  },
} as const

// ─── evaluateSemanticRule ───────────────────────────────────────────────────

const SEMANTIC_EVAL_SCHEMA = {
  name: 'semantic_rule_eval',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      matches:    { type: 'boolean' },
      reason:     { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['matches', 'reason', 'confidence'],
  },
} as const

export async function evaluateSemanticRuleOpenAI(
  jpeg: Buffer,
  rulePrompt: string,
): Promise<SemanticEvalResult | null> {
  const client = getClient()
  if (!client) return null

  const raw = await withRetry(async () => {
    const r = await client.chat.completions.create({
      model: MODEL_VISION,
      messages: [
        {
          role: 'system',
          content: `Você é um sistema de monitoramento CFTV. Avalie objetivamente se a cena casa com a regra do operador. Em caso de dúvida moderada, prefira matches=true (a regra dispara — operador valida depois).`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `REGRA DO OPERADOR:\n"${rulePrompt}"\n\nAvalie a imagem abaixo. confidence é 0-1. reason em PT-BR (até 20 palavras).`,
            },
            { type: 'image_url', image_url: { url: toImageUrl(jpeg), detail: 'high' } },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: SEMANTIC_EVAL_SCHEMA as any },
      max_completion_tokens: 200,
      temperature: 0.1,
    })
    return r.choices[0]?.message?.content ?? null
  })

  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SemanticEvalResult
    return {
      matches: !!parsed.matches,
      reason:  parsed.reason,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    }
  } catch (e: any) {
    logger.warn({ raw: raw.slice(0, 200), err: e.message }, 'openai_eval_invalid_json')
    return null
  }
}

export async function classifyFalsePositiveOpenAI(
  jpeg: Buffer,
  claimedLabel: string,
): Promise<FalsePositiveResult | null> {
  const client = getClient()
  if (!client) return null

  const raw = await withRetry(async () => {
    const r = await client.chat.completions.create({
      model: MODEL_VISION,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `O detector YOLO marcou esta imagem como contendo: "${claimedLabel}".
Avalie se a detecção é real ou falso positivo. Se falso, indique o que é de verdade.`,
            },
            { type: 'image_url', image_url: { url: toImageUrl(jpeg), detail: 'low' } },
          ],
        },
      ],
      response_format: { type: 'json_schema', json_schema: FP_SCHEMA as any },
      max_completion_tokens: 200,
    })
    return r.choices[0]?.message?.content ?? null
  })

  if (!raw) return null
  try { return JSON.parse(raw) as FalsePositiveResult }
  catch { return null }
}
