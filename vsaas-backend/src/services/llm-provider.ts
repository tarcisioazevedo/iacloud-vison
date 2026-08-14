/**
 * LLM Provider Wrapper — proxy entre Gemini e OpenAI.
 *
 * Selecionado por env `LLM_PROVIDER`:
 *   - `gemini` (default — backward compat)
 *   - `openai`
 *
 * Expõe a MESMA superfície de funções que `genai.service.ts` pra describe
 * de eventos, OCR de placa e classificação de FP. Quem chama (event-genai-job)
 * importa daqui, não direto do service Gemini.
 *
 * Embedding de texto também tem chaveamento: ver `getActiveEmbeddingService()`
 * e `getActiveEmbeddingProviderName()`. Isso afeta:
 *  - Provider gravado em SemanticEmbedding.provider
 *  - Query: /semantic-search/query precisa filtrar por provider compatível
 *
 * IMPORTANTE: vetores Gemini e OpenAI moram em ESPAÇOS DIFERENTES — ambos
 * são 768D mas comparar cosine entre os dois dá lixo. O /query já filtra
 * por `vectorDim`, mas pra rigor precisaríamos também filtrar por provider.
 */

import {
  describeEvent           as describeEventGemini,
  readPlate               as readPlateGemini,
  classifyFalsePositive   as classifyFalsePositiveGemini,
  evaluateSemanticRule    as evaluateSemanticRuleGemini,
  genaiAvailable          as geminiAvailable,
  type DescribeResult,
  type PlateOCRResult,
  type FalsePositiveResult,
  type SemanticEvalResult,
} from './genai.service'

import {
  describeEventOpenAI,
  readPlateOpenAI,
  classifyFalsePositiveOpenAI,
  evaluateSemanticRuleOpenAI,
  openaiGenaiAvailable,
} from './openai-genai.service'

import { getGeminiEmbeddingService } from './semantic-search/gemini-embedding.service'
import { getOpenAIEmbeddingService } from './semantic-search/openai-embedding.service'

export type LLMProvider = 'openai' | 'gemini'

export function getActiveLLMProvider(): LLMProvider {
  const v = (process.env.LLM_PROVIDER ?? 'gemini').toLowerCase()
  return v === 'openai' ? 'openai' : 'gemini'
}

// ─── Vision (describe / OCR / FP) ───────────────────────────────────────────

export async function describeEvent(
  jpegs: Buffer[],
  objectType: string,
): Promise<DescribeResult | null> {
  if (getActiveLLMProvider() === 'openai') return describeEventOpenAI(jpegs, objectType)
  return describeEventGemini(jpegs, objectType)
}

export async function readPlate(jpeg: Buffer): Promise<PlateOCRResult | null> {
  if (getActiveLLMProvider() === 'openai') return readPlateOpenAI(jpeg)
  return readPlateGemini(jpeg)
}

export async function classifyFalsePositive(
  jpeg: Buffer,
  claimedLabel: string,
): Promise<FalsePositiveResult | null> {
  if (getActiveLLMProvider() === 'openai') return classifyFalsePositiveOpenAI(jpeg, claimedLabel)
  return classifyFalsePositiveGemini(jpeg, claimedLabel)
}

export async function evaluateSemanticRule(
  jpeg: Buffer,
  rulePrompt: string,
): Promise<SemanticEvalResult | null> {
  if (getActiveLLMProvider() === 'openai') return evaluateSemanticRuleOpenAI(jpeg, rulePrompt)
  return evaluateSemanticRuleGemini(jpeg, rulePrompt)
}

export function genaiAvailable(): boolean {
  return getActiveLLMProvider() === 'openai' ? openaiGenaiAvailable() : geminiAvailable()
}

// ─── Embedding (texto) ──────────────────────────────────────────────────────

export interface ActiveEmbeddingService {
  embed(text: string): Promise<Float32Array>
  isAvailable(): boolean
  stats(): { available: boolean; cacheSize: number; cacheMax: number; model: string }
}

export function getActiveEmbeddingService(): ActiveEmbeddingService {
  if (getActiveLLMProvider() === 'openai') return getOpenAIEmbeddingService()
  return getGeminiEmbeddingService()
}

/**
 * Nome do provider gravado em `SemanticEmbedding.provider` + usado pra
 * versionar o índice. Quem busca deve filtrar embeddings com provider
 * igual ao do query embedding pra evitar comparar espaços diferentes.
 */
export function getActiveEmbeddingProviderName(): string {
  return getActiveLLMProvider() === 'openai' ? 'openai' : 'gemini'
}

export function getActiveEmbeddingModelVersion(): string {
  if (getActiveLLMProvider() === 'openai') {
    return process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small'
  }
  return 'gemini-embedding-001'
}

// Re-exports de tipos pra quem importava do genai.service direto
export type { DescribeResult, PlateOCRResult, FalsePositiveResult, SemanticEvalResult }
