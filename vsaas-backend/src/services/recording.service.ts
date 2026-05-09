/**
 * Recording Service — supervisor de ffmpeg de gravação contínua.
 *
 * Para cada câmera com `recordEnabled=true` E `recordMode != 'DISABLED'`,
 * mantemos um processo ffmpeg rodando 24/7 que:
 *   1. Abre o RTSP (com transcodificação ZERO — copy do H.264)
 *   2. Segmenta o stream em arquivos .ts de SEGMENT_SECONDS via flag
 *      `-f segment` do ffmpeg
 *   3. A cada segmento fechado, recebe via stderr o nome do arquivo +
 *      timestamps, e insere uma linha em RecordingSegment.
 *
 * Trade-offs deliberados nesta versão MVP:
 *   - Sem transcoding (CPU ~zero por câmera). Perde-se redimensionar.
 *   - Apenas vídeo (sem áudio). Reduz CPU 30%, evita codec mismatch.
 *   - Modo de gravação (recordMode) é simplificado: ALL/MOTION viram
 *     "ALL" na prática nesta versão. Motion-gating é P1 (precisa
 *     coordenar com edge agent ou módulo de detecção).
 *   - Recovery simples: se ffmpeg crashar, supervisor reabre em 10s.
 *
 * Como resilência funciona:
 *   1. Job principal (`tickReconcile`) roda a cada 30s, lendo todas
 *      câmeras com recordEnabled=true e comparando com `running` Map.
 *   2. Câmera nova → spawn ffmpeg
 *   3. Câmera removida/desabilitada → mata ffmpeg
 *   4. Ffmpeg crashou (close < 10s ago) → backoff antes de reabrir
 *
 * Retention:
 *   Job separado (`tickRetention`) roda a cada 1h, varre RecordingSegment
 *   buscando registros com endedAt < (NOW - cam.recordRetainDays). Para
 *   cada match: DELETE row + remove arquivo do storage.
 */
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { decryptSecret } from '../lib/crypto'
import { recordingStorage } from './recording-storage.service'
import { getEffectiveRecordingMode } from './recording-effective-mode.service'
import { isRecordingPaused } from './recording-tmpfs-watchdog.service'
import { detectCodec, ffmpegCopyArgs } from './ffprobe-codec.service'

const FFMPEG_BIN     = process.env.FFMPEG_BIN ?? 'ffmpeg'
const SEGMENT_SECONDS = Number(process.env.RECORDING_SEGMENT_SECONDS ?? 6)
const RECONCILE_MS   = Number(process.env.RECORDING_RECONCILE_MS ?? 30_000)
const RETENTION_MS   = Number(process.env.RECORDING_RETENTION_MS ?? 60 * 60 * 1000)
const ENABLED        = process.env.RECORDING_ENABLED !== 'false' // default ON

interface RunningProc {
  proc: ChildProcess
  cameraId: string
  startedAt: number
  /** Codec detectado via ffprobe — usado no INSERT do RecordingSegment. */
  codec: 'h264' | 'h265' | 'unknown'
  /** Buffer de logs ffmpeg pra debug. Limitado a 8KB. */
  stderrTail: string
}

// Estado em memória do supervisor. Reset no restart do backend (idempotente).
const running = new Map<string, RunningProc>()
let reconcileTimer: NodeJS.Timeout | null = null
let retentionTimer: NodeJS.Timeout | null = null

const GO2RTC_RTSP_URL = process.env.GO2RTC_RTSP_URL ?? 'rtsp://go2rtc:8554'

/**
 * Resolve URL RTSP final da câmera para gravação.
 *
 * Para câmeras RTMP_PUSH: usa o RTSP output do go2rtc
 * Para câmeras RTSP_PULL: usa o RTSP direto da câmera
 */
async function resolveRtspUrl(cameraId: string): Promise<string | null> {
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: {
      rtspMainUrl: true,
      rtspUsername: true,
      rtspPasswordEnc: true,
      ingestMode: true,
      go2rtcStreamId: true,
    },
  })
  if (!cam) return null

  // RTMP_PUSH: câmera envia stream para go2rtc, gravamos do RTSP out do go2rtc
  if (cam.ingestMode === 'RTMP_PUSH' && cam.go2rtcStreamId) {
    return `${GO2RTC_RTSP_URL}/${cam.go2rtcStreamId}`
  }

  // RTSP_PULL: gravamos direto da câmera
  if (!cam.rtspMainUrl) return null
  let url = cam.rtspMainUrl
  const hasInlineAuth = /^rtsps?:\/\/[^/@]+:[^/@]+@/i.test(url)
  if (!hasInlineAuth && cam.rtspUsername) {
    const password = decryptSecret(cam.rtspPasswordEnc) ?? ''
    try {
      const u = new URL(url)
      u.username = encodeURIComponent(cam.rtspUsername)
      u.password = encodeURIComponent(password)
      url = u.toString()
    } catch { /* mal formada — devolve original */ }
  }
  return url
}

/**
 * Spawna ffmpeg pra gravar a câmera em segmentos. Retorna o ChildProcess.
 *
 * Estratégia de comando:
 *   - `-rtsp_transport tcp` — confiável em redes corporativas/NAT
 *   - `-i <url>` — input
 *   - `-an` — sem áudio (reduz CPU + evita codec mismatch)
 *   - `-c:v copy` — copy H.264 sem transcode (CPU ~zero)
 *   - `-f segment` — segmenter ffmpeg nativo
 *   - `-segment_time SEGMENT_SECONDS` — duração alvo de cada segmento
 *   - `-segment_format mpegts` — container .ts (HLS-friendly)
 *   - `-segment_list pipe:1` — lista nomes em stdout (parseamos pra registrar
 *     no DB conforme cada segmento é fechado)
 *   - `-reset_timestamps 1` — cada segmento começa em PTS 0 (HLS espera isso)
 *   - `-strftime 1 <pattern>.ts` — strftime no nome do arquivo (segura
 *     timestamp do início real, não inferido)
 *   - Pattern: <BASE>/<cameraId>/<YYYY-MM-DD>/<HH-mm-ss>_<segmentId>.ts
 */
async function startFfmpegFor(cameraId: string): Promise<RunningProc | null> {
  const url = await resolveRtspUrl(cameraId)
  if (!url) {
    logger.warn({ cameraId }, 'recording_no_rtsp_url')
    return null
  }

  // strftime do ffmpeg substitui o timestamp; segmentId placeholder é
  // adicionado depois quando registramos no DB. Usamos um placeholder fixo
  // que injetamos no parsing (não precisa do ffmpeg saber o ID).
  const SEGMENT_ID_TOKEN = '__SEGID__'
  const baseDir = `${cameraId}/%Y-%m-%d`
  const fileTpl = `%H-%M-%S_${SEGMENT_ID_TOKEN}.ts`
  const fullTpl = `${recordingStorage.absolutePath(`${baseDir}/${fileTpl}`)}`

  // Garante que o dir-pai do dia existe ANTES do spawn (ffmpeg falha
  // silenciosamente se não existir e ficamos sem segmentos).
  await recordingStorage.ensureDir(`${cameraId}/${new Date().toISOString().slice(0, 10)}/dummy`)

  // G10 fix: detecta codec antes do spawn pra escolher bitstream filter
  // correto. h265 sem hevc_mp4toannexb não toca em HLS.js.
  const codec = await detectCodec(url)
  const codecArgs = ffmpegCopyArgs(codec)

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-timeout', '10000000',
    '-fflags', '+genpts',
    '-i', url,
    '-an',
    ...codecArgs,
    '-f', 'segment',
    '-segment_time', String(SEGMENT_SECONDS),
    '-segment_format', 'mpegts',
    '-segment_list', 'pipe:1',          // lista de nomes em stdout
    '-segment_list_type', 'flat',
    '-reset_timestamps', '1',
    '-strftime', '1',
    fullTpl,
  ]

  logger.info({ cameraId, segmentSec: SEGMENT_SECONDS, codec }, 'recording_starting')

  const proc = spawn(FFMPEG_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })

  const rec: RunningProc = { proc, cameraId, startedAt: Date.now(), codec, stderrTail: '' }

  // stdout: lista de arquivos. Cada linha = 1 segmento fechado, no formato
  // do `-segment_list flat`. Aproveitamos pra registrar no DB.
  let buffer = ''
  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let lineEnd: number
    while ((lineEnd = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, lineEnd).trim()
      buffer = buffer.slice(lineEnd + 1)
      if (!line) continue
      // line = caminho absoluto do segmento que acabou de fechar
      registerClosedSegment(cameraId, line).catch(err => {
        logger.warn({ err, cameraId, line }, 'recording_segment_register_failed')
      })
    }
  })

  // stderr: erros do ffmpeg (loglevel=error filtra ruído)
  proc.stderr!.on('data', (chunk: Buffer) => {
    rec.stderrTail += chunk.toString('utf8')
    if (rec.stderrTail.length > 8192) rec.stderrTail = rec.stderrTail.slice(-8192)
  })

  proc.on('error', (err) => {
    logger.error({ err, cameraId }, 'recording_ffmpeg_error')
  })

  proc.on('close', (code, signal) => {
    const lifetimeMs = Date.now() - rec.startedAt
    logger.info({ cameraId, code, signal, lifetimeMs, stderrTail: rec.stderrTail.slice(-500) },
      'recording_ffmpeg_closed')
    running.delete(cameraId)
    // tickReconcile() vai re-spawnar no próximo ciclo se câmera ainda
    // tiver recordEnabled. Backoff 10s implícito via RECONCILE_MS.
  })

  return rec
}

/**
 * Registra 1 segmento fechado no DB. Chamado por linha que sai do stdout
 * do ffmpeg. Faz stat() pra pegar tamanho real (BigInt).
 *
 * O nome do arquivo tem o token __SEGID__ que substituímos pelo UUID real.
 * Como o ffmpeg não conhece o UUID, ele escreveu o arquivo com o literal
 * "__SEGID__" no nome. Aqui geramos o UUID, renomeamos o arquivo, e
 * inserimos a linha. Se renomeação falha, o arquivo continua acessível
 * pelo nome original (storagePath na DB reflete o nome real).
 */
async function registerClosedSegment(cameraId: string, line: string): Promise<void> {
  // ffmpeg `-segment_list_type flat` emite uma linha por segmento fechado.
  // Conteúdo varia por versão: às vezes basename ("17-37-23___SEGID__.ts"),
  // às vezes path absoluto ("/recordings/cam-X/2026-04-26/17-37-23___SEGID__.ts").
  // Tratamos os dois casos.
  //
  // Pega HH-MM-SS do nome (basename). Se houver `YYYY-MM-DD/` no path,
  // usa essa data; senão assume "hoje UTC" (defasagem máx. 1 dia em
  // rollover de meia-noite, irrelevante na prática).
  const trimmed = line.trim()
  const fileMatch = trimmed.match(/(\d{2})-(\d{2})-(\d{2})_/)
  if (!fileMatch) {
    logger.warn({ line: trimmed }, 'recording_segment_unparseable_name')
    return
  }
  const [, hh, mm, ss] = fileMatch
  const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2})\//)
  const datePart = dateMatch
    ? dateMatch[1]
    : new Date().toISOString().slice(0, 10)
  const startedAt = new Date(`${datePart}T${hh}:${mm}:${ss}.000Z`)

  // Caminho absoluto pra renomear/stat. Se o ffmpeg deu só o basename,
  // reconstrói usando a base do storage + dia.
  const segmentId = randomUUID()
  const baseAbs = recordingStorage.absolutePath('')
  let absolutePath: string
  if (trimmed.startsWith('/') || /^[A-Z]:/.test(trimmed)) {
    absolutePath = trimmed
  } else {
    absolutePath = `${baseAbs}/${cameraId}/${datePart}/${trimmed}`.replace(/\\/g, '/')
  }

  const newAbsPath = absolutePath.replace('__SEGID__', segmentId)
  const relativePath = newAbsPath.startsWith(baseAbs)
    ? newAbsPath.slice(baseAbs.length).replace(/^[\/\\]/, '')
    : `${cameraId}/${datePart}/${trimmed.split('/').pop() ?? trimmed}`.replace('__SEGID__', segmentId)

  // Renomeia o arquivo pra ter o UUID no nome (rastreabilidade no FS).
  try {
    const { promises: fsP } = await import('fs')
    await fsP.rename(absolutePath, newAbsPath)
  } catch (err: any) {
    // ffmpeg às vezes emite a linha do segmento ANTES do arquivo estar
    // 100% fechado/sincronizado. Tenta de novo após pequeno delay.
    await new Promise(r => setTimeout(r, 200))
    try {
      const { promises: fsP } = await import('fs')
      await fsP.rename(absolutePath, newAbsPath)
    } catch {
      logger.debug({ err: err?.message, absolutePath }, 'recording_rename_skipped')
    }
  }

  // Stat pra tamanho real (arquivo local recém-escrito pelo ffmpeg)
  const stat = await recordingStorage.localStat(relativePath)
  const sizeBytes = stat?.size ?? 0

  // Duração ≈ SEGMENT_SECONDS (pode ser menor no último segmento truncado).
  // Pra precisão real, ffprobe leria o arquivo mas custa I/O. Aceitamos
  // a aproximação aqui — UI não depende de precisão sub-segundo.
  const durationSec = SEGMENT_SECONDS
  const endedAt = new Date(startedAt.getTime() + durationSec * 1000)

  // G3 fix (2026-05-09): hasMotion deixa de ser inferido pelo recordMode.
  // Default false; markSegmentMotion() seta true quando detecção real toca
  // o range. Em modo MOTION/ACTIVE_OBJECTS, segments começam com
  // deleteAfterReviewAt = now+grace; cleaner apaga se passar sem flag motion/event.
  const cam = await prisma.camera.findUnique({
    where:  { id: cameraId },
    select: { recordMode: true, fps: true },
  }).catch(() => null)

  const inferredMotion = false   // sempre false na criação — flips via markSegmentMotion
  const isMotionGated = cam?.recordMode === 'MOTION' || cam?.recordMode === 'ACTIVE_OBJECTS'
  const motionGateGraceMs = Number(process.env.MOTION_GATE_GRACE_MS ?? 5 * 60_000)
  const deleteAfterReviewAt = isMotionGated
    ? new Date(Date.now() + motionGateGraceMs)
    : null

  // INSERT com PENDING quando há cloud, LOCAL_ONLY caso contrário.
  // G9 fix: atualizar uploadStatus após upload async (antes ficava sempre
  // PENDING e o worker re-uploava o mesmo arquivo no próximo tick).
  const cloudEnabled = recordingStorage.isCloudEnabled()
  const initialStatus = cloudEnabled ? 'PENDING' as const : 'LOCAL_ONLY' as const

  // G10 fix: usa codec detectado pelo ffprobe (lookup via RunningProc).
  const procRec = running.get(cameraId)
  const detectedCodec = procRec?.codec === 'h265' ? 'h265' : 'h264'

  const created = await prisma.recordingSegment.create({
    data: {
      id: segmentId,
      cameraId,
      startedAt,
      endedAt,
      durationSec,
      sizeBytes: BigInt(sizeBytes),
      storagePath: relativePath,
      codec: detectedCodec,
      fps: cam?.fps ?? null,
      hasMotion: inferredMotion,
      uploadStatus: initialStatus,
      deleteAfterReviewAt,
    },
  }).catch(err => {
    logger.warn({ err, segmentId, cameraId }, 'recording_segment_insert_failed')
    return null
  })

  if (!created) return  // INSERT falhou — não tenta upload sem registro

  // Upload assíncrono pra cloud + atualização de status.
  // Em caso de falha mantém PENDING + incrementa attempts. Worker reprocessa.
  if (cloudEnabled) {
    prisma.camera.findUnique({
      where: { id: cameraId },
      select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
    }).then(async (cam) => {
      const integradorId = cam?.site?.clienteFinal?.integradorId
      if (!integradorId) {
        // G12 fix preview: sem integradorId resolvível, não usa bucket "default".
        await prisma.recordingSegment.update({
          where: { id: segmentId },
          data: {
            uploadAttempts: 1,
            uploadError:    'integradorId not resolvable (camera tenancy misconfigured)',
          },
        }).catch(() => {})
        logger.error({ cameraId, segmentId },
          'recording_no_integrador_segment_orphan')
        return
      }
      const ok = await recordingStorage.uploadToCloud(integradorId, relativePath)
      if (ok) {
        await prisma.recordingSegment.update({
          where: { id: segmentId },
          data: {
            uploadStatus:   'UPLOADED',
            uploadedAt:     new Date(),
            uploadBucket:   `icv-${integradorId}`,
            uploadAttempts: 1,
          },
        }).catch(() => {})
      } else {
        await prisma.recordingSegment.update({
          where: { id: segmentId },
          data: {
            uploadAttempts: 1,
            uploadError:    'first attempt returned false',
          },
        }).catch(() => {})
      }
    }).catch(err => {
      logger.warn({ err, segmentId, relativePath }, 'recording_cloud_upload_async_failed')
    })
  }
}

/**
 * Reconcilia processos rodando vs câmeras que deveriam estar gravando.
 * - Spawn novos
 * - Mata os que não deveriam mais estar rodando
 */
async function tickReconcile(): Promise<void> {
  if (!ENABLED) return
  if (isRecordingPaused()) {
    logger.warn('recording_reconcile_skipped_tmpfs_paused')
    // Para todos os ffmpeg ativos pra liberar tmpfs.
    for (const [cameraId, rec] of running.entries()) {
      try { rec.proc.kill('SIGTERM') } catch {}
      logger.info({ cameraId }, 'recording_killing_due_to_tmpfs_pause')
    }
    return
  }

  // Prisma 5.22 rejeita `{ not: null }` e `NOT: { x: null }` em campos
  // nullable. Filtramos client-side: pega todos com recordEnabled e
  // descarta os sem rtspMainUrl no loop interno via startFfmpegFor()
  // (que retorna null e o supervisor pula).
  // Para RTSP_PULL: filtra por status ACTIVE (câmera precisa responder)
  // Para RTMP_PUSH: não filtra status — o stream sendo empurrado já indica
  //                 que a câmera está ativa. ffmpeg falha se stream não existir.
  //
  // IMPORTANTE — deploymentMode:
  //   EDGE_BOX: gravação é responsabilidade da box local; cloud só ingere
  //   segmentos via POST /iacv-box/segments/upload. Cloud NÃO tenta puxar
  //   RTSP de IPs locais (192.168.x.x) que não tem rota.
  //   CLOUD_DIRECT: câmera tem IP público/RTMP_PUSH; cloud puxa direto.
  const cams = await prisma.camera.findMany({
    where: {
      recordEnabled: true,
      recordMode: { not: 'DISABLED' },
      deploymentMode: 'CLOUD_DIRECT',
    },
    select: {
      id: true, rtspMainUrl: true, ingestMode: true, go2rtcStreamId: true, status: true,
      recordEnabled: true, recordMode: true,
    },
  })

  // Resolve modo efetivo de cada câmera (G2 fix — RecordingSchedule aplicado).
  // Câmera só entra em `desired` se shouldRecord=true para o instante atual.
  const now = new Date()
  const desired = new Set<string>()
  for (const c of cams) {
    if (c.ingestMode === 'RTMP_PUSH') continue  // cloud-direct-recorder cuida
    if (!c.rtspMainUrl || c.status !== 'ACTIVE') continue

    const eff = await getEffectiveRecordingMode(c.id, now, {
      recordEnabled: c.recordEnabled,
      recordMode:    c.recordMode as any,
    })
    if (eff.shouldRecord) desired.add(c.id)
  }

  // Mata processos que não deveriam mais estar rodando
  for (const [cameraId, rec] of running.entries()) {
    if (!desired.has(cameraId)) {
      logger.info({ cameraId }, 'recording_stopping_disabled')
      try { rec.proc.kill('SIGTERM') } catch {}
    }
  }

  // Spawn novos
  for (const cameraId of desired) {
    if (running.has(cameraId)) continue
    const rec = await startFfmpegFor(cameraId)
    if (rec) running.set(cameraId, rec)
  }
}

/**
 * Retention: apaga segmentos mais velhos que `recordRetainDays` da câmera.
 * Roda de hora em hora — não precisa ser preciso ao segundo, basta limpar
 * antes do disco encher.
 */
async function tickRetention(): Promise<void> {
  if (!ENABLED) return

  // Carrega todas câmeras com retention configurada + integradorId para multi-tenant
  const cams = await prisma.camera.findMany({
    select: {
      id: true,
      recordRetainDays: true,
      site: { select: { clienteFinal: { select: { integradorId: true } } } },
    },
  })

  for (const cam of cams) {
    const days = cam.recordRetainDays ?? 7
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // Resolve integradorId para bucket multi-tenant
    const integradorId = cam.site?.clienteFinal?.integradorId ?? 'default'

    // G7 fix (2026-05-09): só apaga segments cuja sorte de upload já foi
    // resolvida — UPLOADED ou LOCAL_ONLY (cloud não habilitado), ou FAILED
    // com attempts esgotados (worker desistiu). PENDING fica protegido pra
    // não perder gravação que poderia ainda ser recuperada.
    const expired = await prisma.recordingSegment.findMany({
      where: {
        cameraId: cam.id,
        endedAt: { lt: cutoff },
        OR: [
          { uploadStatus: 'UPLOADED' },
          { uploadStatus: 'LOCAL_ONLY' },
          { uploadStatus: 'FAILED', uploadAttempts: { gte: 5 } },
        ],
      },
      select: { id: true, storagePath: true },
      take: 500,
    })
    if (expired.length === 0) continue

    // Remove arquivos em batch (R2/S3 multi-tenant)
    const paths = expired.map(s => s.storagePath)
    await recordingStorage.removeMany(integradorId, paths)

    // Remove registros
    const result = await prisma.recordingSegment.deleteMany({
      where: { id: { in: expired.map(s => s.id) } },
    })

    logger.info({ cameraId: cam.id, removed: result.count, cutoff, integradorId, storage: recordingStorage.getActiveStorage() }, 'recording_retention_cleaned')
  }
}

/**
 * Marca segmentos sobrepostos a um intervalo como tendo motion ou evento.
 * Chamado pela rota /iacv-box/event quando o edge envia detecção/alerta,
 * e pela rota POST /detections/ingest quando bboxes chegam.
 *
 * - `from`/`to`: range do evento (`to` opcional, default = `from + 1s`)
 * - `kind`: 'motion' ou 'event'
 *
 * Atualiza apenas segments cujo range sobrepõe `[from, to]` para a câmera dada.
 * Operação idempotente — UPDATE mesmo já marcado é no-op no Postgres.
 */
export async function markSegmentMotion(
  cameraId: string,
  from: Date,
  to: Date | null,
  kind: 'motion' | 'event' = 'motion',
): Promise<void> {
  const end = to ?? new Date(from.getTime() + 1000)
  // G3 fix: pre/post-buffer aplicado aqui — segments dentro do range
  // [from - preCaptureSec, to + postCaptureSec] são protegidos do cleaner.
  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { recordPreCaptureSec: true, recordPostCaptureSec: true },
  }).catch(() => null)
  const preMs  = (cam?.recordPreCaptureSec  ?? 5)  * 1000
  const postMs = (cam?.recordPostCaptureSec ?? 10) * 1000
  const protectedFrom = new Date(from.getTime() - preMs)
  const protectedTo   = new Date(end.getTime() + postMs)

  try {
    await prisma.recordingSegment.updateMany({
      where: {
        cameraId,
        startedAt: { lte: protectedTo },
        endedAt:   { gte: protectedFrom },
      },
      data: kind === 'motion'
        ? { hasMotion: true,  deleteAfterReviewAt: null }
        : { hasEvent:  true,  deleteAfterReviewAt: null },
    })
  } catch (err) {
    logger.warn({ err, cameraId, from, to, kind }, 'mark_segment_motion_failed')
  }
}

export const recordingService = {
  /** Inicia o supervisor. Idempotente em hot-reload (HMR). */
  start(): void {
    if (!ENABLED) {
      logger.info('recording_service_disabled (RECORDING_ENABLED=false)')
      return
    }
    if (reconcileTimer) return  // já rodando

    logger.info({
      segmentSec: SEGMENT_SECONDS,
      reconcileMs: RECONCILE_MS,
      retentionMs: RETENTION_MS,
    }, 'recording_service_starting')

    // Primeiro tick imediato — pra logging mostrar status logo no boot
    tickReconcile().catch(err => logger.error({ err }, 'recording_reconcile_failed'))
    tickRetention().catch(err => logger.error({ err }, 'recording_retention_failed'))

    reconcileTimer = setInterval(() => {
      tickReconcile().catch(err => logger.error({ err }, 'recording_reconcile_failed'))
    }, RECONCILE_MS)

    retentionTimer = setInterval(() => {
      tickRetention().catch(err => logger.error({ err }, 'recording_retention_failed'))
    }, RETENTION_MS)
  },

  stop(): void {
    if (reconcileTimer) { clearInterval(reconcileTimer); reconcileTimer = null }
    if (retentionTimer) { clearInterval(retentionTimer); retentionTimer = null }
    for (const rec of running.values()) {
      try { rec.proc.kill('SIGTERM') } catch {}
    }
    running.clear()
  },

  /** Status pra debug/admin: quais câmeras estão sendo gravadas agora. */
  status(): Array<{ cameraId: string; uptimeMs: number }> {
    const now = Date.now()
    return [...running.entries()].map(([cameraId, rec]) => ({
      cameraId,
      uptimeMs: now - rec.startedAt,
    }))
  },
}
