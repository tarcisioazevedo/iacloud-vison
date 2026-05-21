/**
 * GenAI Service — wrapper único pro Gemini.
 *
 * Funções:
 *  • describe(images, schema) — recebe N JPEGs + JSON schema, retorna objeto
 *  • compare(imgA, imgB, prompt) — boolean/text comparison
 *  • chat(messages, tools) — function calling pro AI Agent
 *  • text(prompt) — resposta livre (briefing)
 *
 * Graceful degradation:
 *  • Sem GEMINI_API_KEY E sem /run/secrets/gemini_api_key → modo no-op
 *    (todas as funções logam WARN e retornam null/no-op)
 *  • Erros API → log WARN, retorna null (caller decide se trata)
 *  • Retry exponencial em 429/500/502/503/504 (3 tentativas)
 *
 * Roles (espelho Frigate):
 *  • describeClient (Flash) — barato, para descrições de events
 *  • chatClient (Pro) — função-calling, para AI Agent
 *  • briefingClient (Pro) — para summarization de período
 */

import fs from 'node:fs'
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import { logger } from '../lib/logger'

function readApiKey(): string {
  // Ordem: env > Docker secret
  const env = process.env.GEMINI_API_KEY?.trim()
  if (env) return env
  try {
    return fs.readFileSync('/run/secrets/gemini_api_key', 'utf-8').trim()
  } catch { /* ignore */ }
  return ''
}

const API_KEY = readApiKey()
const MODEL_FLASH    = process.env.GEMINI_MODEL_FLASH    ?? 'gemini-2.5-flash'
const MODEL_PRO      = process.env.GEMINI_MODEL_PRO      ?? 'gemini-2.5-pro'
// Chat usa Flash por padrão (rápido + alta quota); Pro fica reservado pra
// briefing onde latência não importa. Override via env se quiser Pro no chat.
const MODEL_CHAT     = process.env.GEMINI_MODEL_CHAT     ?? MODEL_FLASH
// Tier "pro" usa Pro pra describe — mais qualidade, mais caro. Default: Flash.
// Set GEMINI_DESCRIBE_TIER=pro pra ativar (ou via env GEMINI_MODEL_DESCRIBE).
const MODEL_DESCRIBE = process.env.GEMINI_MODEL_DESCRIBE
  ?? (process.env.GEMINI_DESCRIBE_TIER === 'pro' ? MODEL_PRO : MODEL_FLASH)
// OCR (placas) — Pro tem qualidade nitidamente superior em texto pequeno.
const MODEL_OCR      = process.env.GEMINI_MODEL_OCR      ?? MODEL_PRO
// Robotics-ER: embodied reasoning. Retorna coordenadas pixel [y,x] 0-1000
// pra objetos descritos em PT-BR. Substitui YOLO quando query é descritiva
// (ex: "homem de moletom vermelho") em vez de classe COCO fixa.
// Gemini 3.1 Pro Preview entrega pointing tão bom quanto Robotics-ER, com
// disponibilidade estável (Robotics-ER 1.5 foi descontinuado em 2026).
const MODEL_POINT    = process.env.GEMINI_MODEL_POINT    ?? 'gemini-3.1-pro-preview'
// Soft cap de billing (defense-in-depth). Cada call incrementa um contador
// in-memory; se exceder, calls subsequentes viram no-op até reset diário.
const DAILY_CALL_CAP = Number(process.env.GENAI_DAILY_CALL_CAP ?? 5000)
let callsToday = 0
let resetAt = Date.now() + 24 * 60 * 60 * 1000

function tickAndCheckCap(): boolean {
  if (Date.now() > resetAt) {
    callsToday = 0
    resetAt = Date.now() + 24 * 60 * 60 * 1000
  }
  callsToday++
  if (callsToday > DAILY_CALL_CAP) {
    logger.warn({ callsToday, cap: DAILY_CALL_CAP }, 'genai_daily_cap_hit')
    return false
  }
  return true
}

let client: GoogleGenerativeAI | null = null
let flashModel: GenerativeModel | null = null
let proModel: GenerativeModel | null = null
let chatModel: GenerativeModel | null = null
let describeModel: GenerativeModel | null = null
let ocrModel: GenerativeModel | null = null
let pointModel: GenerativeModel | null = null

function pickModel(target: string): GenerativeModel | null {
  if (!client) return null
  if (target === MODEL_FLASH) return flashModel
  if (target === MODEL_PRO) return proModel
  return client.getGenerativeModel({ model: target })
}

if (API_KEY) {
  try {
    client = new GoogleGenerativeAI(API_KEY)
    flashModel    = client.getGenerativeModel({ model: MODEL_FLASH })
    proModel      = client.getGenerativeModel({ model: MODEL_PRO })
    chatModel     = pickModel(MODEL_CHAT)
    describeModel = pickModel(MODEL_DESCRIBE)
    ocrModel      = pickModel(MODEL_OCR)
    pointModel    = pickModel(MODEL_POINT)
    logger.info({
      flash: MODEL_FLASH, pro: MODEL_PRO,
      chat: MODEL_CHAT, describe: MODEL_DESCRIBE,
      ocr: MODEL_OCR, point: MODEL_POINT,
      cap: DAILY_CALL_CAP,
    }, 'genai_initialized')
  } catch (e: any) {
    logger.error({ err: e.message }, 'genai_init_failed')
  }
} else {
  logger.warn('genai_disabled — set GEMINI_API_KEY or mount /run/secrets/gemini_api_key')
}

export const genaiAvailable = () => client != null

/**
 * Recarrega os clients Gemini com uma nova API key (runtime).
 * Usado pelo ai-system-config.service quando admin atualiza a key
 * via UI — evita restart do backend.
 *
 * Se `apiKey` vier vazio/null, volta ao fallback (env/secret no boot).
 */
export function reloadGenaiClients(apiKey: string | null | undefined): void {
  const key = (apiKey ?? '').trim() || readApiKey()
  if (!key) {
    client = null
    flashModel = proModel = chatModel = describeModel = ocrModel = pointModel = null
    logger.warn('genai_reloaded_empty — clients disabled')
    return
  }
  try {
    client = new GoogleGenerativeAI(key)
    flashModel    = client.getGenerativeModel({ model: MODEL_FLASH })
    proModel      = client.getGenerativeModel({ model: MODEL_PRO })
    chatModel     = pickModel(MODEL_CHAT)
    describeModel = pickModel(MODEL_DESCRIBE)
    ocrModel      = pickModel(MODEL_OCR)
    pointModel    = pickModel(MODEL_POINT)
    logger.info('genai_reloaded — clients reinitialized with new key')
  } catch (e: any) {
    logger.error({ err: e.message }, 'genai_reload_failed')
  }
}

// =============================================================================
// retry helper
// =============================================================================

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  initialDelayMs = 1000,
): Promise<T | null> {
  let lastErr: any = null
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      const status = e?.status ?? e?.statusCode
      const retriable = !status || [429, 500, 502, 503, 504].includes(status)
      if (!retriable || i === attempts - 1) break
      const delay = initialDelayMs * Math.pow(2, i)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  logger.warn({ err: lastErr?.message }, 'genai_call_failed_after_retries')
  return null
}

// =============================================================================
// describe — Gemini Flash com JSON schema (espelha frigate/genai/gemini.py)
// =============================================================================

export interface DescribeResult {
  description: string
  attributes: {
    people?: Array<{
      clothing_top?: string
      clothing_bottom?: string
      hair?: string
      accessories?: string[]
    }>
    vehicles?: Array<{ type?: string; color?: string; plate?: string }>
    actions?: string[]
    items_carried?: string[]
    scene_notes?: string
  }
}

const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string', description: 'Descrição em português, 1-3 frases.' },
    attributes: {
      type: 'object',
      properties: {
        people: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              clothing_top:    { type: 'string' },
              clothing_bottom: { type: 'string' },
              hair:            { type: 'string' },
              accessories:     { type: 'array', items: { type: 'string' } },
            },
          },
        },
        vehicles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:  { type: 'string' },
              color: { type: 'string' },
              plate: { type: 'string' },
            },
          },
        },
        actions:       { type: 'array', items: { type: 'string' } },
        items_carried: { type: 'array', items: { type: 'string' } },
        scene_notes:   { type: 'string' },
      },
    },
  },
  required: ['description', 'attributes'],
}

const DESCRIBE_SYSTEM_PROMPT = `Você é um analista de vigilância CFTV.
Analise estas imagens de uma câmera de segurança e extraia informações estruturadas em PT-BR.
Seja factual, conciso e específico. Foco: pessoas (vestimenta, acessórios), veículos
(tipo, cor, placa se legível), ações observáveis, objetos sendo carregados.
NÃO especule emoções ou intenções.
Responda APENAS o JSON do schema, sem texto adicional.`

export async function describeEvent(
  jpegBuffers: Buffer[],
  objectType: string,
): Promise<DescribeResult | null> {
  if (!describeModel || !tickAndCheckCap()) return null
  if (jpegBuffers.length === 0) return null

  // Multi-frame: até 3 frames (Frigate-style: início, meio, fim do track).
  // Mais frames = melhor entendimento de AÇÃO (correndo vs caminhando, entrando vs saindo).
  const frames = jpegBuffers.slice(0, 3)
  const promptHint = frames.length > 1
    ? `Foram capturadas ${frames.length} imagens sequenciais do mesmo evento. Descreva considerando a AÇÃO ao longo do tempo (ex: pessoa entrando, carro saindo, objeto sendo carregado).`
    : `Imagem única do evento. Descreva o que vê.`

  const result = await withRetry(async () => {
    const parts: any[] = [
      {
        text: `${DESCRIBE_SYSTEM_PROMPT}\n\nObjeto detectado pelo YOLO: ${objectType}\n${promptHint}`,
      },
      ...frames.map(buf => ({
        inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') },
      })),
    ]
    const response = await describeModel!.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseSchema: DESCRIBE_SCHEMA as any,
      },
    } as any)
    return response.response.text()
  })

  if (!result) return null
  try {
    return JSON.parse(result) as DescribeResult
  } catch (e: any) {
    logger.warn({ raw: result.slice(0, 200), err: e.message }, 'genai_describe_invalid_json')
    return null
  }
}

// =============================================================================
// describeLiveScene — descreve cena atual sob demanda (chat agent ou botão UI)
// Texto livre, sem schema. Pra "o que está acontecendo agora na câmera X?"
// =============================================================================

export async function describeLiveScene(jpeg: Buffer): Promise<string | null> {
  if (!describeModel || !tickAndCheckCap()) return null

  return await withRetry(async () => {
    const response = await describeModel!.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Você é um analista de CFTV. Descreva esta cena ao vivo em PT-BR, factual e objetivo, em 2-4 frases:
- Pessoas (quantas, onde estão, o que parecem fazer)
- Veículos (tipo, cor se visível)
- Ambiente (interior/exterior, dia/noite, contexto)
NÃO especule emoções. NÃO invente.`,
          },
          { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
        ],
      }],
      generationConfig: { candidateCount: 1, temperature: 0.2 },
    } as any)
    return response.response.text() || null
  })
}

// =============================================================================
// captionFrame — descrição curta de um frame de DetectionFrame para indexação
// semântica. Otimizado para busca textual ("carro azul perto da entrada").
//
// Diferenças vs describeLiveScene:
//  - Mais curto (1 frase, ~30 tokens) → embedding mais discriminativo
//  - Foco em objetos+atributos+ação, não narrativa
//  - Estilo Frigate /opt/iacloud-vison/frigate/config/camera/objects.py
//    (analisa intent/behavior pra descrições mais úteis no retrieval)
// =============================================================================

const CAPTION_PROMPT = `Você indexa frames de CFTV para busca semântica.
Descreva esta cena em UMA frase curta em PT-BR (max 25 palavras):
- Cite objetos visíveis (pessoa, carro, moto) + cores/atributos relevantes
- Mencione ação principal (parado, andando, entrando, saindo)
- Inclua contexto físico (rua, garagem, balcão, entrada) se claro
- NÃO especule emoções, identidades nem números (placas, idade)
- NÃO escreva "a imagem mostra"; comece direto pelo conteúdo

Exemplo bom: "Carro branco SUV parado em estacionamento, motorista descendo pelo lado do condutor."
Exemplo ruim: "A imagem mostra uma pessoa que parece estar feliz fazendo algo perto de um veículo."`

export async function captionFrame(jpeg: Buffer): Promise<string | null> {
  if (!describeModel || !tickAndCheckCap()) return null

  return await withRetry(async () => {
    const response = await describeModel!.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: CAPTION_PROMPT },
          { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
        ],
      }],
      generationConfig: { candidateCount: 1, temperature: 0.2, maxOutputTokens: 80 },
    } as any)
    const text = response.response.text()?.trim()
    if (!text || text.length < 5) return null
    return text
  })
}

// =============================================================================
// readPlate — OCR de placa via Gemini Pro (qualidade superior a PaddleOCR
// em condições adversas: noite, baixa resolução, perspectiva).
// =============================================================================

export interface PlateOCRResult {
  plate_text: string         // ABC1234 ou ABC-1A23 (Mercosul)
  confidence: number         // 0-1
  vehicle_type: string       // car | motorcycle | truck | other
  vehicle_color: string      // descrição em PT-BR
  reason: string             // se confidence baixa, por quê
}

const PLATE_SCHEMA = {
  type: 'object',
  properties: {
    plate_text:    { type: 'string' },
    confidence:    { type: 'number' },
    vehicle_type:  { type: 'string' },
    vehicle_color: { type: 'string' },
    reason:        { type: 'string' },
  },
  required: ['plate_text', 'confidence', 'vehicle_type', 'vehicle_color', 'reason'],
}

export async function readPlate(jpeg: Buffer): Promise<PlateOCRResult | null> {
  if (!ocrModel || !tickAndCheckCap()) return null

  const result = await withRetry(async () => {
    const response = await ocrModel!.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Você é um especialista em LPR (License Plate Recognition) brasileiro.
Identifique a placa do veículo nesta imagem (padrão antigo ABC1234 OU Mercosul ABC1A23).
Se a placa não estiver legível, retorne plate_text="" e explique em reason.
Identifique também tipo (car/motorcycle/truck/bus) e cor do veículo.
Responda APENAS o JSON do schema.`,
          },
          { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
        ],
      }],
      generationConfig: {
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseSchema: PLATE_SCHEMA as any,
      },
    } as any)
    return response.response.text()
  })

  if (!result) return null
  try {
    return JSON.parse(result) as PlateOCRResult
  } catch {
    return null
  }
}

// =============================================================================
// compare — Gemini Flash, retorna {same_subject, confidence, reason}
// =============================================================================

export interface CompareResult {
  same_subject: 'yes' | 'no' | 'maybe'
  confidence: number
  reason: string
}

const COMPARE_SCHEMA = {
  type: 'object',
  properties: {
    same_subject: { type: 'string', enum: ['yes', 'no', 'maybe'] },
    confidence: { type: 'number' },
    reason: { type: 'string' },
  },
  required: ['same_subject', 'confidence', 'reason'],
}

export async function compareSubjects(
  imgA: Buffer,
  imgB: Buffer,
  objectType: string,
): Promise<CompareResult | null> {
  if (!flashModel || !tickAndCheckCap()) return null

  const result = await withRetry(async () => {
    const parts: any[] = [
      {
        text: `Compare as duas imagens de câmeras de segurança.
Pergunta: é a MESMA ${objectType}? Considere roupas, altura, cor, acessórios.
Responda APENAS o JSON do schema.`,
      },
      { inlineData: { mimeType: 'image/jpeg', data: imgA.toString('base64') } },
      { inlineData: { mimeType: 'image/jpeg', data: imgB.toString('base64') } },
    ]
    const response = await flashModel!.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseSchema: COMPARE_SCHEMA as any,
      },
    } as any)
    return response.response.text()
  })

  if (!result) return null
  try {
    return JSON.parse(result) as CompareResult
  } catch {
    return null
  }
}

// =============================================================================
// classifyFalsePositive — re-checa detecção marginal (conf < 0.7)
// =============================================================================

export interface FalsePositiveResult {
  is_real: boolean
  what_it_is_really: string
  reason: string
}

const FP_SCHEMA = {
  type: 'object',
  properties: {
    is_real: { type: 'boolean' },
    what_it_is_really: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['is_real', 'what_it_is_really', 'reason'],
}

export async function classifyFalsePositive(
  jpeg: Buffer,
  claimedLabel: string,
): Promise<FalsePositiveResult | null> {
  if (!flashModel || !tickAndCheckCap()) return null

  const result = await withRetry(async () => {
    const response = await flashModel!.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `O detector YOLO marcou esta imagem como contendo: "${claimedLabel}".
Avalie se a detecção é real ou falso positivo.
Se falso, indique o que é de verdade na bbox.
Responda APENAS o JSON do schema.`,
          },
          { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
        ],
      }],
      generationConfig: {
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseSchema: FP_SCHEMA as any,
      },
    } as any)
    return response.response.text()
  })

  if (!result) return null
  try {
    return JSON.parse(result) as FalsePositiveResult
  } catch {
    return null
  }
}

// =============================================================================
// chat — Gemini Pro com function calling (AI Agent)
// =============================================================================

export interface ChatMessage {
  role: 'user' | 'model'
  parts: Array<{ text?: string; functionCall?: any; functionResponse?: any }>
}

export interface FunctionToolDef {
  name: string
  description: string
  parameters: object
}

export interface ChatResult {
  text: string | null
  toolCalls: Array<{ name: string; args: any }>
  finishReason: string
}

export async function chatWithTools(
  history: ChatMessage[],
  tools: FunctionToolDef[],
  systemInstruction?: string,
): Promise<ChatResult | null> {
  if (!chatModel || !tickAndCheckCap()) return null

  const callModel = async (model: GenerativeModel): Promise<ChatResult | null> => {
    return await withRetry(async () => {
      const response = await model.generateContent({
        contents: history as any,
        systemInstruction: systemInstruction
          ? { role: 'system', parts: [{ text: systemInstruction }] }
          : undefined,
        tools: tools.length > 0 ? [{ functionDeclarations: tools }] as any : undefined,
        generationConfig: { candidateCount: 1 },
      } as any)

      const cand = response.response.candidates?.[0]
      const text = response.response.text() || null

      const toolCalls: Array<{ name: string; args: any }> = []
      if (cand?.content?.parts) {
        for (const p of cand.content.parts) {
          if ((p as any).functionCall) {
            const fc = (p as any).functionCall
            toolCalls.push({ name: fc.name, args: fc.args ?? {} })
          }
        }
      }
      return {
        text,
        toolCalls,
        finishReason: cand?.finishReason ?? 'STOP',
      }
    })
  }

  // Primary attempt
  let result = await callModel(chatModel)

  // Fallback Pro→Flash quando Pro sobrecarrega
  if (!result && chatModel === proModel && flashModel) {
    logger.warn('chat_pro_failed_fallback_to_flash')
    result = await callModel(flashModel)
  }

  return result
}

// =============================================================================
// summarize — Gemini Pro pra briefing de período (texto livre)
// =============================================================================

export async function summarizePeriod(prompt: string): Promise<string | null> {
  if (!proModel || !tickAndCheckCap()) return null

  return await withRetry(async () => {
    const response = await proModel!.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { candidateCount: 1 },
    } as any)
    return response.response.text() || null
  })
}

// =============================================================================
// pointToObject — Gemini Robotics-ER aponta coordenadas pixel de objetos
// descritos em PT-BR. Útil pra busca visual livre (não-COCO).
//
// Saída: [y, x] normalizado 0-1000 (formato Robotics-ER) + bbox opcional.
// =============================================================================

export interface PointResult {
  items: Array<{
    label: string                                 // "homem de moletom vermelho"
    point: [number, number]                       // [y, x] 0-1000
    bbox?: [number, number, number, number]       // [ymin, xmin, ymax, xmax] 0-1000
    confidence?: number
  }>
}

const POINT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          point: { type: 'array', items: { type: 'number' } },
          bbox:  { type: 'array', items: { type: 'number' } },
          confidence: { type: 'number' },
        },
        required: ['label', 'point'],
      },
    },
  },
  required: ['items'],
}

export async function pointToObject(jpeg: Buffer, query: string): Promise<PointResult | null> {
  if (!pointModel || !tickAndCheckCap()) return null

  const result = await withRetry(async () => {
    const response = await pointModel!.generateContent({
      contents: [{
        role: 'user',
        parts: [
          {
            text: `Localize na imagem todas as ocorrências de: "${query}".
Para cada uma, retorne:
  - point: [y, x] coordenadas pixel normalizadas 0-1000 do centro do objeto
  - bbox: [ymin, xmin, ymax, xmax] bounding box 0-1000 (se claramente identificável)
  - label: descrição curta em PT-BR
  - confidence: 0-1
Máximo 10 objetos. Se nada corresponde, retorne items=[].
Responda APENAS o JSON do schema.`,
          },
          { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
        ],
      }],
      generationConfig: {
        candidateCount: 1,
        responseMimeType: 'application/json',
        responseSchema: POINT_SCHEMA as any,
      },
    } as any)
    return response.response.text()
  })

  if (!result) return null
  try {
    return JSON.parse(result) as PointResult
  } catch (e: any) {
    logger.warn({ raw: result.slice(0, 200), err: e.message }, 'genai_point_invalid_json')
    return null
  }
}

// =============================================================================
// stats
// =============================================================================

export function genaiStats() {
  return {
    available: genaiAvailable(),
    callsToday,
    cap: DAILY_CALL_CAP,
    resetAt: new Date(resetAt).toISOString(),
    flashModel: MODEL_FLASH,
    proModel: MODEL_PRO,
  }
}
