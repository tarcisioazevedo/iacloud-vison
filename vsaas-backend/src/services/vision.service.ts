/**
 * Cloud Vision API Service
 * Em dev (sem credenciais GCP reais) retorna anotações mockadas realistas.
 */
import { logger } from '../lib/logger'

const IS_DEV = process.env.NODE_ENV !== 'production'

export interface VisionAnnotations {
  faces:      FaceData[]
  labels:     LabelData[]
  logos:      LogoData[]
  objects:    ObjectData[]
  safeSearch: SafeSearchData | null
  rawResponse: any
}

export interface FaceData {
  joy:                number
  sorrow:             number
  anger:              number
  surprise:           number
  headwearLikelihood: number
  hasHeadwear:        boolean
}

export interface LabelData {
  description: string
  score:       number
  topicality:  number
}

export interface LogoData {
  description: string
  score:       number
}

export interface ObjectData {
  name:  string
  score: number
  bbox:  { x: number; y: number; width: number; height: number }
}

export interface SafeSearchData {
  adult:    string
  violence: string
  racy:     string
}

function likelihoodToScore(l: string | null | undefined): number {
  const map: Record<string, number> = {
    UNKNOWN: 0, VERY_UNLIKELY: 0.05, UNLIKELY: 0.2,
    POSSIBLE: 0.5, LIKELY: 0.8, VERY_LIKELY: 0.95,
  }
  return map[l ?? 'UNKNOWN'] ?? 0
}

function mockAnnotations(): VisionAnnotations {
  const emotions = ['joy', 'sorrow', 'neutral', 'surprise']
  const dominant = emotions[Math.floor(Math.random() * emotions.length)]
  return {
    faces: [{
      joy:                dominant === 'joy'      ? 0.9 : Math.random() * 0.3,
      sorrow:             dominant === 'sorrow'   ? 0.8 : Math.random() * 0.2,
      anger:              Math.random() * 0.15,
      surprise:           dominant === 'surprise' ? 0.85 : Math.random() * 0.2,
      headwearLikelihood: Math.random() > 0.7 ? 0.8 : 0.1,
      hasHeadwear:        Math.random() > 0.75,
    }],
    labels: [
      { description: 'person',       score: 0.97, topicality: 0.95 },
      { description: 'shopping bag', score: 0.82, topicality: 0.80 },
      { description: 'clothing',     score: 0.75, topicality: 0.70 },
    ],
    logos: [],
    objects: [
      { name: 'Person', score: 0.95, bbox: { x: 0.3, y: 0.1, width: 0.4, height: 0.85 } },
    ],
    safeSearch: { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' },
    rawResponse: { mock: true },
  }
}

export class VisionService {
  private client: any = null

  private async getClient() {
    if (this.client) return this.client
    try {
      const vision = await import('@google-cloud/vision')
      this.client = new vision.default.ImageAnnotatorClient()
      return this.client
    } catch {
      return null
    }
  }

  async annotate(
    imageB64: string,
    features: ('FACE' | 'LABEL' | 'LOGO' | 'OBJECT' | 'SAFE_SEARCH')[],
  ): Promise<VisionAnnotations> {
    if (IS_DEV) {
      logger.debug({ features }, 'vision_api_mocked')
      return mockAnnotations()
    }

    const client = await this.getClient()
    if (!client) {
      logger.warn('vision_client_unavailable_using_mock')
      return mockAnnotations()
    }

    const featureMap: Record<string, any> = {
      FACE:        { type: 'FACE_DETECTION',      maxResults: 5 },
      LABEL:       { type: 'LABEL_DETECTION',     maxResults: 20 },
      LOGO:        { type: 'LOGO_DETECTION',      maxResults: 10 },
      OBJECT:      { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
      SAFE_SEARCH: { type: 'SAFE_SEARCH_DETECTION' },
    }

    const [response] = await client.annotateImage({
      image:    { content: imageB64 },
      features: features.map((f: string) => featureMap[f]),
    })

    if (response.error?.message) {
      logger.error({ gcpError: response.error.message }, 'vision_api_error')
      throw new Error(`Vision API error: ${response.error.message}`)
    }

    return this._parse(response)
  }

  private _parse(r: any): VisionAnnotations {
    const faces: FaceData[] = (r.faceAnnotations ?? []).map((f: any) => ({
      joy:                likelihoodToScore(f.joyLikelihood),
      sorrow:             likelihoodToScore(f.sorrowLikelihood),
      anger:              likelihoodToScore(f.angerLikelihood),
      surprise:           likelihoodToScore(f.surpriseLikelihood),
      headwearLikelihood: likelihoodToScore(f.headwearLikelihood),
      hasHeadwear:        f.headwearLikelihood === 'LIKELY' || f.headwearLikelihood === 'VERY_LIKELY',
    }))

    const labels: LabelData[] = (r.labelAnnotations ?? []).map((l: any) => ({
      description: l.description ?? '',
      score:       l.score ?? 0,
      topicality:  l.topicality ?? 0,
    }))

    const logos: LogoData[] = (r.logoAnnotations ?? []).map((l: any) => ({
      description: l.description ?? '',
      score:       l.score ?? 0,
    }))

    const objects: ObjectData[] = (r.localizedObjectAnnotations ?? []).map((o: any) => {
      const verts = o.boundingPoly?.normalizedVertices ?? []
      const xs = verts.map((v: any) => v.x ?? 0)
      const ys = verts.map((v: any) => v.y ?? 0)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      return { name: o.name ?? '', score: o.score ?? 0, bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } }
    })

    const ss = r.safeSearchAnnotation
    const safeSearch: SafeSearchData | null = ss
      ? { adult: ss.adult, violence: ss.violence, racy: ss.racy }
      : null

    return { faces, labels, logos, objects, safeSearch, rawResponse: r }
  }
}

export const visionService = new VisionService()
