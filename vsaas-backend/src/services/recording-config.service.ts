/**
 * Recording Config Service — descreve o que CADA box deve gravar.
 *
 * Esta config é entregue à box no response do `POST /iacv-box/heartbeat`,
 * permitindo que ela descubra dinamicamente:
 *   - Quais câmeras estão sob seu edgeNodeId
 *   - Quais devem ser gravadas (recordEnabled + recordMode)
 *   - URL RTSP local de cada uma (com credenciais decifradas)
 *   - Duração de cada segment (.ts) que ela deve gerar
 *   - Onde fazer upload (rota multipart ou presigned)
 *
 * A box implementa o cliente uploader que:
 *   1. Pra cada câmera com `enabled: true`, mantém um ffmpeg rodando
 *      capturando o RTSP local + segmentando em .ts de `segmentSec`
 *   2. Para cada segment fechado, faz POST `uploadEndpoint` com
 *      multipart (file + meta JSON contendo cameraId/startedAt/durationSec)
 *   3. Em caso de falha, queue local + retry exponencial (5 min, 30 min, 1h…)
 *
 * Multi-tenancy:
 *   Cada box só recebe as câmeras do SEU edgeNodeId. Cross-camera é
 *   bloqueado pelo `assertBoxOwnership` no upload.
 *
 * Default: TODA câmera nova criada com `recordEnabled=true` e
 * `deploymentMode=EDGE_BOX` automaticamente entra nessa config — a box
 * não precisa ser reconfigurada manualmente.
 */
import { prisma } from '../lib/prisma'
import { decryptSecret } from '../lib/crypto'

const SEGMENT_SEC_DEFAULT = Number(process.env.RECORDING_SEGMENT_SECONDS ?? 6)

export interface CameraRecordingConfig {
  cameraId:        string
  cameraName:      string
  enabled:         boolean
  /**
   * Modo de gravação enviado pra edge box.
   *
   * IMPORTANTE — compat: A box em produção ainda usa nomenclatura antiga
   * ('ALL', 'ACTIVE_OBJECTS'). Os valores no DB foram renomeados em 2026-05-27
   * (CONTINUOUS, EVENT), mas o payload pra box mantém os antigos até a box
   * receber update. Mapeamento na linha abaixo (buildRecordingConfig).
   *
   * ALL = contínuo · MOTION = só com movimento · DISABLED = não grava
   */
  mode:            'ALL' | 'MOTION' | 'DISABLED' | 'ACTIVE_OBJECTS'
  /** Duração alvo de cada segment .ts (segundos). */
  segmentSec:      number
  /** RTSP main (alta resolução) — usado para gravação. Credenciais embutidas. */
  rtspMainUrl:     string | null
  /** RTSP sub (baixa resolução) — opcional, para preview/análise leve. */
  rtspSubUrl:      string | null
  /** Codec esperado nos segments. Edge respeita ou re-encoda. */
  codec:           'h264' | 'h265'
  /** Dias de retenção (informativo — cloud já cuida via worker). */
  retainDays:      number
  /**
   * Onde a box deve fazer POST do segment.
   * Multipart: arquivo + meta JSON. Mais simples.
   */
  uploadEndpoint:  string
  /**
   * Endpoint pro fluxo presigned (PUT direto no R2 + register).
   * Recomendado pra boxes que vão escalar (sem bandwidth no servidor).
   */
  presignEndpoint: string
  registerEndpoint: string
}

export interface BoxRecordingConfig {
  /** Versão para a box detectar mudanças. Hash dos cameraIds + recordEnabled+rtsp. */
  revision:         string
  /** Heartbeat suficiente — box re-pulla esta config a cada heartbeat (30s). */
  refreshIntervalSec: number
  /** Endpoint padrão para uploads multipart. */
  uploadEndpoint:   string
  /** Endpoints opcionais pro fluxo presigned. */
  presignEndpoint:  string
  registerEndpoint: string
  cameras:          CameraRecordingConfig[]
}

const UPLOAD_PATH    = '/iacv-box/segments/upload'
const PRESIGN_PATH   = '/iacv-box/segments/presign'
const REGISTER_PATH  = '/iacv-box/segments/register'

/**
 * Monta a config de gravação para uma box específica.
 * Inclui SOMENTE câmeras pertencentes ao edgeNodeId daquela box.
 */
export async function buildRecordingConfig(edgeNodeId: string): Promise<BoxRecordingConfig> {
  const cameras = await prisma.camera.findMany({
    where: {
      edgeNodeId,
      deploymentMode: 'EDGE_BOX',
      active: true,
    },
    select: {
      id: true,
      name: true,
      recordEnabled: true,
      recordMode: true,
      rtspMainUrl: true,
      rtspSubUrl: true,
      rtspUsername: true,
      rtspPasswordEnc: true,
      recordRetainDays: true,
      // Hint pro futuro: codec preferido por câmera
    },
  })

  // Compat: traduz nome novo do enum (DB) para o nome antigo aceito pela box.
  const toBoxMode = (m: string | null | undefined): 'ALL' | 'MOTION' | 'DISABLED' | 'ACTIVE_OBJECTS' => {
    if (m === 'CONTINUOUS') return 'ALL'
    if (m === 'EVENT')      return 'ACTIVE_OBJECTS'
    if (m === 'MOTION' || m === 'DISABLED') return m
    return 'ALL'
  }

  const items: CameraRecordingConfig[] = cameras.map(c => {
    const password = decryptSecret(c.rtspPasswordEnc) ?? ''
    return {
      cameraId:    c.id,
      cameraName:  c.name,
      enabled:     c.recordEnabled === true && c.recordMode !== 'DISABLED',
      mode:        toBoxMode(c.recordMode as any),
      segmentSec:  SEGMENT_SEC_DEFAULT,
      rtspMainUrl: injectAuth(c.rtspMainUrl, c.rtspUsername, password),
      rtspSubUrl:  injectAuth(c.rtspSubUrl,  c.rtspUsername, password),
      codec:       'h264',
      retainDays:  c.recordRetainDays ?? 7,
      uploadEndpoint:   UPLOAD_PATH,
      presignEndpoint:  PRESIGN_PATH,
      registerEndpoint: REGISTER_PATH,
    }
  })

  // Revision: hash estável pros itens — box compara e recarrega só se mudou.
  const revisionInput = items
    .map(i => `${i.cameraId}:${i.enabled}:${i.mode}:${i.rtspMainUrl ?? ''}:${i.segmentSec}`)
    .sort()
    .join('|')
  const revision = simpleHash(revisionInput)

  return {
    revision,
    refreshIntervalSec: 30,
    uploadEndpoint:    UPLOAD_PATH,
    presignEndpoint:   PRESIGN_PATH,
    registerEndpoint:  REGISTER_PATH,
    cameras: items,
  }
}

/**
 * Injeta usuário/senha numa URL RTSP. Se a URL já tiver auth inline,
 * preserva. Ex: rtsp://1.2.3.4/x + admin:abc → rtsp://admin:abc@1.2.3.4/x.
 */
function injectAuth(url: string | null, username: string | null, password: string): string | null {
  if (!url) return null
  // Já tem auth inline? Mantém.
  if (/^rtsps?:\/\/[^/@]+:[^/@]+@/i.test(url)) return url
  if (!username) return url
  try {
    const u = new URL(url)
    u.username = encodeURIComponent(username)
    u.password = encodeURIComponent(password)
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Hash determinístico (FNV-1a 32-bit). Suficiente pra detectar mudanças
 * de config — não precisa de qualidade criptográfica.
 */
function simpleHash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
