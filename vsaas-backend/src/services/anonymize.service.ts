/**
 * Anonymize Service — extrai metadados analíticos sem PII.
 *
 * Regras LGPD:
 * - Sem biometria (embeddings faciais)
 * - Sem reconhecimento de identidade
 * - Emoções e atributos são probabilísticos e aggregados
 * - Faixa etária estimada por modelo (não exato)
 */
import { VisionAnnotations } from './vision.service'

export interface AnonMetadata {
  ageRange:       string | null
  gender:         string | null
  dominantEmotion:string | null
  emotionJoy:     number | null
  emotionSorrow:  number | null
  emotionAnger:   number | null
  emotionSurprise:number | null
  hasHat:         boolean | null
  hasGlasses:     boolean | null
  labelsJson:     string[] | null
  logosJson:      Array<{ description: string; score: number }> | null
  detectedObjectsJson: Array<{ name: string; score: number }> | null
  safeSearchViolation: boolean
}

// Mapeamento de labels de Vision API para categoria de óculos
const GLASSES_LABELS = new Set(['glasses', 'sunglasses', 'eyewear', 'goggles', 'spectacles'])

export function anonymize(
  annotations: VisionAnnotations,
  externalAgeRange?: string,
  externalGender?: string,
): AnonMetadata {
  const face = annotations.faces[0] ?? null

  // Emoção dominante da face principal
  let dominantEmotion: string | null = null
  let maxScore = 0

  if (face) {
    const emotions: Record<string, number> = {
      joy: face.joy, sorrow: face.sorrow,
      anger: face.anger, surprise: face.surprise,
    }
    for (const [emotion, score] of Object.entries(emotions)) {
      if (score > maxScore) { maxScore = score; dominantEmotion = emotion }
    }
    if (maxScore < 0.4) dominantEmotion = 'neutral'
  }

  // Detectar óculos via labels
  const labelDescriptions = annotations.labels.map(l => l.description.toLowerCase())
  const hasGlasses = labelDescriptions.some(l => GLASSES_LABELS.has(l))

  // Filtrar labels relevantes (clothing, items, accessories — sem PII)
  const relevantLabels = annotations.labels
    .filter(l => l.score > 0.7 && l.topicality > 0.5)
    .map(l => l.description)
    .slice(0, 10)

  // SafeSearch: marcar violação se violence=LIKELY ou VERY_LIKELY
  const safeSearchViolation =
    annotations.safeSearch?.violence === 'LIKELY' ||
    annotations.safeSearch?.violence === 'VERY_LIKELY' ||
    false

  return {
    ageRange:        externalAgeRange ?? null,
    gender:          externalGender ?? null,
    dominantEmotion,
    emotionJoy:      face?.joy     ?? null,
    emotionSorrow:   face?.sorrow  ?? null,
    emotionAnger:    face?.anger   ?? null,
    emotionSurprise: face?.surprise ?? null,
    hasHat:          face?.hasHeadwear ?? null,
    hasGlasses:      hasGlasses,
    labelsJson:      relevantLabels.length ? relevantLabels : null,
    logosJson:       annotations.logos.length
      ? annotations.logos.map(l => ({ description: l.description, score: l.score }))
      : null,
    detectedObjectsJson: annotations.objects.length
      ? annotations.objects.map(o => ({ name: o.name, score: o.score }))
      : null,
    safeSearchViolation,
  }
}
