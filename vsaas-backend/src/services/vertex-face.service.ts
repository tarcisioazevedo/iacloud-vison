/**
 * Vertex AI Face Recognition Service
 *
 * Usa o modelo multimodalembedding@001 do Vertex AI para gerar embeddings
 * de 1408 dimensões a partir de imagens. Esses embeddings são comparados
 * via cosine-similarity contra a biblioteca de identidades (FaceIdentity +
 * FaceEmbedding) para reconhecer pessoas.
 *
 * Também expõe helper para Cloud Vision Face Detection, usado para recortar
 * o rosto antes de gerar embedding (melhor precisão).
 *
 * DEV mode (VERTEX_FACE_MODE=mock): retorna embeddings determinísticos via
 * hash SHA-256 para desenvolvimento sem GCP.
 *
 * Referência:
 *   https://cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-multimodal-embeddings
 */
import { GoogleAuth } from 'google-auth-library'
import crypto from 'crypto'
import { logger } from '../lib/logger'

const PROJECT  = process.env.GCP_PROJECT_ID ?? ''
const LOCATION = process.env.VERTEX_LOCATION ?? 'us-central1'
const MODE     = process.env.VERTEX_FACE_MODE ?? (process.env.NODE_ENV === 'production' ? 'live' : 'mock')
const MODEL    = process.env.VERTEX_FACE_MODEL ?? 'multimodalembedding@001'
const DIM      = 1408  // dimensão do multimodalembedding@001

export interface FaceEmbeddingResult {
  vector:     number[]     // 1408 floats
  dimension:  number
  modelUsed:  string
  durationMs: number
}

export interface FaceDetection {
  bbox:         { x: number; y: number; width: number; height: number }
  confidence:   number
  landmarks?:   Record<string, { x: number; y: number }>
  rollAngle?:   number
  panAngle?:    number
  tiltAngle?:   number
  emotions?:    Record<string, string> // joy/sorrow/anger/surprise → likelihood
  attributes?:  {
    headwear?:     string
    blurred?:      string
    underExposed?: string
  }
}

export class VertexFaceService {
  private auth: GoogleAuth | null = null

  private getAuth(): GoogleAuth {
    if (!this.auth) {
      this.auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      })
    }
    return this.auth
  }

  /**
   * Gera embedding multimodal a partir de uma imagem base64 ou URL GCS.
   * Retorna vetor de 1408 dims.
   */
  async embed(input: { imageBase64?: string; gcsUri?: string; text?: string }): Promise<FaceEmbeddingResult> {
    const started = Date.now()

    if (MODE === 'mock') {
      return this.mockEmbed(input, started)
    }

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${MODEL}:predict`

    const instance: any = {}
    if (input.imageBase64) instance.image = { bytesBase64Encoded: input.imageBase64 }
    else if (input.gcsUri) instance.image = { gcsUri: input.gcsUri }
    if (input.text)        instance.text  = input.text

    const client  = await this.getAuth().getClient()
    const headers = await (client as any).getRequestHeaders()
    const resp = await fetch(url, {
      method:  'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ instances: [instance] }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Vertex embed ${resp.status}: ${text.slice(0, 300)}`)
    }
    const json = await resp.json() as any
    const vector: number[] = json.predictions?.[0]?.imageEmbedding ?? json.predictions?.[0]?.textEmbedding
    if (!Array.isArray(vector) || vector.length !== DIM) {
      throw new Error(`Embedding inválido (dim=${vector?.length ?? 'n/a'})`)
    }
    return {
      vector,
      dimension:  vector.length,
      modelUsed:  MODEL,
      durationMs: Date.now() - started,
    }
  }

  /**
   * Detecta rostos na imagem via Cloud Vision FACE_DETECTION.
   * Retorna bboxes + landmarks + emotions.
   */
  async detectFaces(imageBase64: string): Promise<FaceDetection[]> {
    if (MODE === 'mock') {
      return [{
        bbox:       { x: 120, y: 80, width: 180, height: 220 },
        confidence: 0.95 + Math.random() * 0.04,
        rollAngle:  Math.random() * 4 - 2,
        panAngle:   Math.random() * 6 - 3,
        tiltAngle:  Math.random() * 4 - 2,
        emotions:   { joy: 'LIKELY', sorrow: 'VERY_UNLIKELY', anger: 'VERY_UNLIKELY', surprise: 'UNLIKELY' },
        attributes: { headwear: 'VERY_UNLIKELY', blurred: 'VERY_UNLIKELY', underExposed: 'UNLIKELY' },
      }]
    }
    const url = `https://vision.googleapis.com/v1/images:annotate`
    const client  = await this.getAuth().getClient()
    const headers = await (client as any).getRequestHeaders()
    const resp = await fetch(url, {
      method:  'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        requests: [{
          image:    { content: imageBase64 },
          features: [{ type: 'FACE_DETECTION', maxResults: 20 }],
        }],
      }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Vision face detect ${resp.status}: ${text.slice(0, 300)}`)
    }
    const json = await resp.json() as any
    const faces = json.responses?.[0]?.faceAnnotations ?? []
    return faces.map((f: any) => {
      const poly = f.boundingPoly?.vertices ?? []
      const x = Math.min(...poly.map((v: any) => v.x ?? 0))
      const y = Math.min(...poly.map((v: any) => v.y ?? 0))
      const maxX = Math.max(...poly.map((v: any) => v.x ?? 0))
      const maxY = Math.max(...poly.map((v: any) => v.y ?? 0))
      return {
        bbox:       { x, y, width: maxX - x, height: maxY - y },
        confidence: f.detectionConfidence ?? 0,
        rollAngle:  f.rollAngle, panAngle: f.panAngle, tiltAngle: f.tiltAngle,
        emotions:   {
          joy:      f.joyLikelihood,
          sorrow:   f.sorrowLikelihood,
          anger:    f.angerLikelihood,
          surprise: f.surpriseLikelihood,
        },
        attributes: {
          headwear:     f.headwearLikelihood,
          blurred:      f.blurredLikelihood,
          underExposed: f.underExposedLikelihood,
        },
      }
    })
  }

  /**
   * Mock determinístico para DEV — mesmo input sempre produz mesmo embedding.
   * Isso permite testar o fluxo de enroll/match sem GCP.
   */
  private mockEmbed(input: any, started: number): FaceEmbeddingResult {
    const seed = crypto.createHash('sha256')
      .update(JSON.stringify(input))
      .digest()
    // Expande seed de 32 bytes → 1408 floats normalizados em [-1, 1]
    const vector = new Array(DIM)
    for (let i = 0; i < DIM; i++) {
      const byte = seed[i % seed.length]
      vector[i] = (byte / 255) * 2 - 1
    }
    // Normaliza (L2)
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0))
    const normalized = vector.map(v => v / norm)
    return {
      vector:     normalized,
      dimension:  DIM,
      modelUsed:  `${MODEL} [mock]`,
      durationMs: Date.now() - started,
    }
  }

  /** Cosine similarity entre dois vetores (assume já L2-normalizados). */
  cosineSim(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      na  += a[i] * a[i]
      nb  += b[i] * b[i]
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb)
    return denom === 0 ? 0 : dot / denom
  }

  /** Busca top-K identidades mais próximas entre embeddings candidatos. */
  topK(query: number[], candidates: Array<{ id: string; identityId: string; vector: number[] }>, k = 5) {
    const scored = candidates.map(c => ({
      ...c,
      score: this.cosineSim(query, c.vector),
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }
}

export const vertexFaceService = new VertexFaceService()

logger.info({ mode: MODE, model: MODEL, dim: DIM }, 'vertex_face_service_init')
