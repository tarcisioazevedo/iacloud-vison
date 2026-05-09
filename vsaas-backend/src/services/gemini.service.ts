/**
 * gemini.service.ts — Gemini Flash via REST API (sem SDK, usa fetch nativo Node 20).
 * Analisa frame JPEG e retorna descrição em PT-BR + labels estruturados.
 */
import fs     from 'fs'
import { logger } from '../lib/logger'

function readSecret(name: string): string | undefined {
  const fileEnv = process.env[`${name}_FILE`]
  if (fileEnv && fs.existsSync(fileEnv)) {
    try { return fs.readFileSync(fileEnv, 'utf-8').trim() } catch {}
  }
  return process.env[name]
}

const GEMINI_API_KEY = readSecret('GEMINI_API_KEY')
const GEMINI_MODEL   = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'
const API_URL        = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

export interface GeminiFrameResult {
  description:  string      // PT-BR, ≤ 120 chars
  labels:       string[]    // inglês, até 8 termos
  personCount:  number
  vehicleCount: number
  hasPerson:    boolean
  hasVehicle:   boolean
  rawText:      string
}

const SYSTEM_PROMPT = `Você é um sistema de videomonitoramento inteligente. Analise esta imagem de câmera de segurança.
Responda APENAS com JSON (sem markdown, sem bloco \`\`\`) com estes campos:
- "description": frase curta em português sobre o que está acontecendo (máximo 120 caracteres)
- "labels": array de até 8 termos em inglês detectados (ex: ["person", "car", "bag", "desk"])
- "personCount": número inteiro de pessoas visíveis (0 se nenhuma)
- "vehicleCount": número inteiro de veículos visíveis (0 se nenhum)`

export async function analyzeFrame(jpegBase64: string): Promise<GeminiFrameResult> {
  if (!GEMINI_API_KEY) {
    logger.debug('gemini_skipped_no_api_key')
    return _empty('Sem chave Gemini configurada')
  }

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        { text: SYSTEM_PROMPT },
      ],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 300 },
  }

  let rawText = ''
  try {
    const resp = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(20_000),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      logger.warn({ status: resp.status, err: errText.slice(0, 200) }, 'gemini_api_error')
      return _empty(`Gemini ${resp.status}`)
    }

    const data = await resp.json() as any
    rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''

    const cleaned = rawText.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim()
    const parsed  = JSON.parse(cleaned)

    const hasPerson  = (parsed.personCount ?? 0) > 0 ||
                       (parsed.labels ?? []).some((l: string) => ['person', 'people', 'man', 'woman', 'child'].includes(l.toLowerCase()))
    const hasVehicle = (parsed.vehicleCount ?? 0) > 0 ||
                       (parsed.labels ?? []).some((l: string) => ['car', 'vehicle', 'truck', 'motorcycle', 'bus'].includes(l.toLowerCase()))

    logger.debug({ description: parsed.description, labels: parsed.labels }, 'gemini_frame_analyzed')

    return {
      description:  String(parsed.description ?? '').slice(0, 120),
      labels:       Array.isArray(parsed.labels) ? parsed.labels.slice(0, 8) : [],
      personCount:  Number(parsed.personCount ?? 0),
      vehicleCount: Number(parsed.vehicleCount ?? 0),
      hasPerson,
      hasVehicle,
      rawText,
    }
  } catch (err: any) {
    logger.warn({ err: err.message, rawText: rawText.slice(0, 200) }, 'gemini_parse_error')
    return _empty(err.message)
  }
}

function _empty(reason: string): GeminiFrameResult {
  return { description: '', labels: [], personCount: 0, vehicleCount: 0, hasPerson: false, hasVehicle: false, rawText: reason }
}
