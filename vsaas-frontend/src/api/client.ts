import axios, { AxiosError } from 'axios'
import * as Sentry from '@sentry/react'
import useSWR, { SWRConfiguration } from 'swr'

// Exportado: o SnapshotLoopPlayer precisa montar URL absoluta para o <img>
// (tag <img> não passa pelo axios interceptor; o ticket já vai na query string).
// Em produção, usa URL relativa /api (proxy Caddy strip o prefixo).
// Em dev local, VITE_API_URL pode apontar pra http://localhost:3000.
export const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const api = axios.create({ baseURL: BASE_URL })

// Inject JWT token on every request (exceto login e rotas públicas)
api.interceptors.request.use(cfg => {
  const isPublic = cfg.url?.includes('/auth/login') || cfg.url?.includes('/portal/exchange')
  if (!isPublic) {
    const token = localStorage.getItem('icv_token')
    if (token) cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

/**
 * Interceptor de resposta — trata casos transversais que toda página sofre.
 *
 * 401: token expirado/inválido. Limpa storage e redireciona pro login.
 *      Exceção: deixa o /auth/login passar com erro normal pra UI mostrar
 *      "credenciais inválidas".
 *
 * 429: rate limit. Loga para debug — UI pode escolher mostrar toast lendo
 *      `error.response.headers['ratelimit-reset']` (segundos até liberar).
 *
 * x-request-id: backend manda em toda resposta. Anexamos no error pra
 *      mensagens "Erro #abc-123 — copie ao reportar suporte".
 */
api.interceptors.response.use(
  resp => resp,
  (error: AxiosError) => {
    const status = error.response?.status
    const url    = error.config?.url ?? ''
    const reqId  = (error.response?.headers as Record<string, string> | undefined)?.['x-request-id']

    if (status === 401 && !url.includes('/auth/login') && !url.includes('/portal/exchange')) {
      // Captura role ANTES de limpar pra decidir destino do redirect.
      // Sessões CLIENTE_VIEWER (Sprint CF.4) entraram via magic-link no portal
      // — mandar pra /login seria errado (eles não têm credenciais). O destino
      // certo é /portal (entry) onde podem colar outro link.
      const role = localStorage.getItem('icv_role')
      const isPortalSession = role === 'CLIENTE_VIEWER'
      const onPortal = window.location.pathname.startsWith('/portal')

      localStorage.removeItem('icv_token')
      localStorage.removeItem('icv_role')

      if (isPortalSession || onPortal) {
        // Limpa também cliente cacheado pra forçar entry limpa.
        localStorage.removeItem('icv_cliente_final')
        localStorage.removeItem('icv_portal_branding')
        // Loop guard: só redireciona se não estiver já na entry.
        if (!/^\/portal\/?($|\?)/.test(window.location.pathname + window.location.search)) {
          window.location.href = '/portal?expired=1'
        }
      } else if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?expired=1'
      }
    }

    if (status === 429) {
      const reset = (error.response?.headers as Record<string, string> | undefined)?.['ratelimit-reset']
      console.warn('[api] rate limited', { url, retryAfterSec: reset, reqId })
    }

    if (reqId) {
      ;(error as { requestId?: string }).requestId = reqId
    }

    if (status && status >= 500) {
      Sentry.captureException(error, {
        tags: { 'api.url': url, 'api.status': String(status) },
        ...(reqId && { extra: { requestId: reqId } }),
      })
    }

    return Promise.reject(error)
  },
)

/**
 * Extrai mensagem amigável de erro do backend.
 * Backend retorna {error: 'CODE', message: '...', issues?: ZodIssue[]}.
 */
export function formatApiError(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err.message : String(err)
  }
  const data = err.response?.data as
    | { message?: string; error?: string; issues?: { path?: string[]; message: string }[] }
    | undefined
  if (data?.issues?.length) {
    const first = data.issues[0]
    const path = first.path?.join('.') ?? 'campo'
    return `${path}: ${first.message}`
  }
  return data?.message ?? data?.error ?? err.message
}

// Global fetcher for SWR
const fetcher = (url: string) => api.get(url).then(r => r.data)

const DEFAULT_SWR: SWRConfiguration = {
  refreshInterval: 15_000,   // auto-refresh a cada 15s
  revalidateOnFocus: true,
}

// ── BI hooks ──────────────────────────────────────────────────────────────

export function useKpis() {
  return useSWR('/bi/kpis', fetcher, { ...DEFAULT_SWR, refreshInterval: 15_000 })
}

export function useFlowHourly(days = 7) {
  return useSWR(`/bi/flow/hourly?days=${days}`, fetcher, DEFAULT_SWR)
}

export function useDemographics(days = 30) {
  return useSWR(`/bi/demographics?days=${days}`, fetcher, DEFAULT_SWR)
}

export function useOccupancy() {
  return useSWR('/bi/occupancy', fetcher, { ...DEFAULT_SWR, refreshInterval: 30_000 })
}

export function useEvidence(limit = 20) {
  return useSWR(`/bi/evidence?limit=${limit}`, fetcher, { ...DEFAULT_SWR, refreshInterval: 20_000 })
}

export function usePpeCompliance() {
  return useSWR('/bi/ppe/compliance', fetcher, DEFAULT_SWR)
}

export function useCounting(cameraId?: string, granularity = '1hour', days = 7) {
  const params = new URLSearchParams({ granularity, days: String(days) })
  if (cameraId) params.append('cameraId', cameraId)
  return useSWR(`/bi/counting?${params}`, fetcher, DEFAULT_SWR)
}

// ── IA Analytics (Sprint 1.1 — Dashboard de IA) ──────────────────────────
export interface IaKpis {
  periodDays: number
  total: number
  last24h: number
  prevPeriodTotal: number
  deltaPct: number | null
  activeCameras: number
  withEvidencePct: number
  bySeverity: { INFO: number; WARNING: number; CRITICAL: number }
}
export interface IaBreakdown {
  periodDays: number
  total: number
  byModel: { model: string; count: number; pct: number }[]
  byEventType: { eventType: string; count: number }[]
}
export interface IaHeatmap {
  periodDays: number
  matrix: number[][]   // [7 dow][24 hour]
  max: number
  total: number
}
export interface IaTopCamera {
  cameraId: string
  cameraName: string
  siteName: string | null
  clientName: string | null
  events: number
}
export interface IaTimelinePoint {
  bucket: string
  total: number
  warning: number
  critical: number
}

export function useIaKpis(days = 7) {
  return useSWR<IaKpis>(`/bi/ia/kpis?days=${days}`, fetcher, DEFAULT_SWR)
}
export function useIaBreakdown(days = 7) {
  return useSWR<IaBreakdown>(`/bi/ia/breakdown?days=${days}`, fetcher, DEFAULT_SWR)
}
export function useIaHeatmap(days = 14) {
  return useSWR<IaHeatmap>(`/bi/ia/heatmap?days=${days}`, fetcher, DEFAULT_SWR)
}
export function useIaTopCameras(days = 7, limit = 10) {
  return useSWR<{ periodDays: number; data: IaTopCamera[] }>(
    `/bi/ia/top-cameras?days=${days}&limit=${limit}`, fetcher, DEFAULT_SWR,
  )
}
export function useIaTimeline(days = 30, granularity: 'day' | 'hour' = 'day') {
  return useSWR<{ periodDays: number; granularity: string; data: IaTimelinePoint[] }>(
    `/bi/ia/timeline?days=${days}&granularity=${granularity}`, fetcher, DEFAULT_SWR,
  )
}

// ── Sites ────────────────────────────────────────────────────────────────
// Backend faz isolamento multi-tenant via JWT — devolve apenas sites do
// integrador/cliente do usuário logado.
export interface SiteRow {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  active: boolean
  clienteFinal: { id: string; name: string; tradeName: string | null }
  _count: { cameras: number }
}
export interface SitesResponse {
  sites: SiteRow[]
  total: number
}
export function useSites(includeInactive = false) {
  const qs = includeInactive ? '?includeInactive=true' : ''
  return useSWR<SitesResponse>('/sites' + qs, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  })
}
export function useSite(id: string | null) {
  return useSWR<SiteRow>(id ? `/sites/${id}` : null, fetcher)
}
export async function createSite(body: {
  clienteFinalId: string
  name: string
  address?: string
  city?: string
  state?: string
  country?: string
  latitude?: number
  longitude?: number
  timezone?: string
}): Promise<SiteRow> {
  const { data } = await api.post('/sites', body)
  return data
}

// ── Edge Nodes ───────────────────────────────────────────────────────────
// Para popular o dropdown "Edge Node" no ConfigTab da câmera. Backend
// aplica isolamento multi-tenant via JWT (Edge → Site → ClienteFinal →
// Integrador) e omite secrets (apiToken, go2rtcAuth) na resposta.
export interface EdgeNodeRow {
  id: string
  name: string
  serialNumber: string
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'MAINTENANCE' | 'PROVISIONING'
  model: string | null
  accelerator: string | null
  ipLocal: string | null
  lastHeartbeat: string | null
  firmwareVersion: string | null
  yoloModelVersion: string | null
  go2rtcEndpoint: string | null   // null = live indisponível neste edge
  cpuUsage: number | null
  memUsage: number | null
  tempCelsius: number | null
  site: {
    id: string
    name: string
    clienteFinal: { id: string; name: string }
  }
  _count: { cameras: number }
}
export interface EdgeNodesResponse {
  edgeNodes: EdgeNodeRow[]
  total: number
}
export function useEdgeNodes(opts?: { siteId?: string; integradorId?: string; includeOffline?: boolean }) {
  const params = new URLSearchParams()
  if (opts?.siteId) params.set('siteId', opts.siteId)
  if (opts?.integradorId) params.set('integradorId', opts.integradorId)
  if (opts?.includeOffline) params.set('includeOffline', 'true')
  const qs = params.toString() ? `?${params.toString()}` : ''
  return useSWR<EdgeNodesResponse>('/edge-nodes' + qs, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 30_000,
  })
}

// Gap 2 — Provisionamento via UI
export interface ProvisionEdgePayload {
  siteId:            string
  name:              string
  serialNumber:      string
  description?:      string
  model?:            string
  accelerator?:      string
  macAddress?:       string
  firmwareVersion?:  string
  yoloModelVersion?: string
  technicianEmail?:  string
  sendEmail?:        boolean
}
export interface ProvisionEdgeResponse {
  edgeNode: {
    id: string
    name: string
    serialNumber: string
    status: string
    site:         { id: string; name: string }
    clienteFinal: { id: string; name: string }
  }
  /** ⚠️ Chave de licença aparece UMA VEZ — copiar imediatamente. */
  licenseKey: string
  message: string
  email: { sent: boolean; to?: string; error: string | null } | null
  bootstrap: {
    edgeNodeId:   string
    licenseKey:   string
    backendUrl:   string
    heartbeatSec: number
  }
}
export async function provisionEdgeNode(payload: ProvisionEdgePayload) {
  const { data } = await api.post('/edge-nodes/provision', payload)
  return data as ProvisionEdgeResponse
}

export async function rotateEdgeToken(edgeNodeId: string) {
  const { data } = await api.post(`/edge-nodes/${edgeNodeId}/rotate-token`)
  return data as { edgeNodeId: string; apiToken: string; warning: string }
}

export async function deleteEdgeNode(edgeNodeId: string) {
  const { data } = await api.delete(`/edge-nodes/${edgeNodeId}`)
  return data as { ok: boolean; deletedId: string }
}

export async function generateLicenseKey(edgeNodeId: string, description?: string) {
  const { data } = await api.post('/iacv-box/generate-key', { edgeNodeId, description })
  return data as { licenseKey: string; edgeNodeId: string; message: string; instructions: any }
}

export async function revokeLicense(edgeNodeId: string) {
  const { data } = await api.post(`/edge-nodes/${edgeNodeId}/rotate-token`)
  return data as { edgeNodeId: string; apiToken: string; warning: string }
}

// ── Integration Snapshot (IACV Box bridge panel) ─────────────────────────

export interface IntegrationHeartbeat {
  id: string
  cpuUsage: number
  memUsage: number
  diskUsage: number
  tempCelsius: number | null
  fpsCurrent: number | null
  recordedAt: string
}

export interface IntegrationEvent {
  id: string
  eventType: string
  severity: string
  objectCount: number
  classes: string[]
  capturedAt: string
  processedAt: string
  camera: { id: string; name: string }
}

export interface IntegrationSnapshot {
  boxId: string
  serialNumber: string
  name: string
  description: string | null
  licensed: boolean
  status: string
  lastHeartbeatAt: number | null
  serverTime: string
  telemetry: {
    cpuUsage: number | null
    memUsage: number | null
    diskUsage: number | null
    tempCelsius: number | null
  }
  firmwareVersion: string | null
  yoloModelVersion: string | null
  site: { id: string; name: string }
  client: { id: string; name: string }
  cameras: { id: string; name: string; status: string; go2rtcStreamId: string | null }[]
  camerasTotal: number
  camerasOnline: number
  skills: Record<string, { enabled: boolean; name: string }>
  pendingCommands: unknown[]
  pendingCommandsCount: number
  recentHeartbeats: IntegrationHeartbeat[]
  recentEvents: IntegrationEvent[]
  openApiVersion: string
}

export function useIntegrationSnapshot(boxId: string | null) {
  return useSWR<IntegrationSnapshot>(
    boxId ? `/iacv-box/${boxId}/integration/snapshot` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30_000 },
  )
}

// ── RTMP Push Ingest (camera→cloud) ──────────────────────────────────────
//
// Modo de ingestão alternativo ao RTSP_PULL: a câmera empurra RTMP pro
// nosso endpoint público (`rtmp://ingest.iacloud.com.br/live/<key>`),
// atravessando NAT do cliente sem hardware extra.
//
// O backend NUNCA devolve a stream key em GET /cameras (sanitizada).
// Pra revelar, use revealRtmpIngestKey(); para rotacionar, regenerate.

export interface IngestConfig {
  rtmpHost: string
  rtmpPort: number
  rtmpUrlBase: string  // ex: "rtmp://ingest.iacloud.com.br/live"
}

/** Configuração pública (FQDN/porta) — usado no card "Modo de ingestão". */
export function useIngestConfig() {
  return useSWR<IngestConfig>('/config/ingest', fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 0,  // hostname público é estático, não revalida
  })
}

export interface RtmpIngestKeyResponse {
  key: string | null
  url: string | null
  host?: string
  port?: number
}

/** Revela a stream key (com auditoria — não chame sem ação explícita do operador). */
export async function revealRtmpIngestKey(cameraId: string): Promise<RtmpIngestKeyResponse> {
  const { data } = await api.get(`/cameras/${cameraId}/rtmp-ingest-key`)
  return data
}

/** Gera nova key — invalida a anterior. Operador precisa atualizar a config da câmera. */
export async function regenerateRtmpIngestKey(cameraId: string): Promise<RtmpIngestKeyResponse> {
  const { data } = await api.post(`/cameras/${cameraId}/rtmp-ingest-key/regenerate`)
  return data
}

// ── Admin Ingest Log (SUPER_ADMIN) ───────────────────────────────────────

export type IngestEvent =
  | 'PUBLISH_START' | 'PUBLISH_END' | 'AUTH_OK'
  | 'AUTH_FAIL' | 'UNKNOWN_PATH' | 'ERROR'

export interface IngestLogItem {
  id: string
  ts: string                 // ISO date
  event: IngestEvent
  streamPath: string
  remoteAddr: string | null
  cameraId: string | null
  bytesIn: string | null     // BigInt como string (serializado pelo backend)
  detailsJson: Record<string, unknown> | null
  camera: { id: string; name: string; siteId: string } | null
}

export interface IngestLogResponse {
  items: IngestLogItem[]
  total: number
  limit: number
  offset: number
  sinceUtc: string
}

export interface IngestLogStats {
  sinceUtc: string
  stats: Record<IngestEvent, number>
  topFailers: { remoteAddr: string; count: number }[]
}

export function useIngestLog(filters: {
  limit?: number; offset?: number;
  event?: IngestEvent; cameraId?: string; remoteAddr?: string; since?: string
} = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v != null && v !== '') qs.set(k, String(v))
  // Sprint CF.3: rota saiu de /admin/ingest-log (SUPER_ADMIN-only) para
  // /ingest-log (escopada a tenant via subdomínio + JWT).
  const url = `/ingest-log${qs.toString() ? '?' + qs.toString() : ''}`
  return useSWR<IngestLogResponse>(url, fetcher, {
    refreshInterval: 5_000,    // dashboard de auditoria — atualiza ~5s
    revalidateOnFocus: true,
  })
}

export function useIngestLogStats() {
  return useSWR<IngestLogStats>('/ingest-log/stats', fetcher, {
    refreshInterval: 10_000,
    revalidateOnFocus: false,
  })
}

// ── HLS Playback (gravações) ─────────────────────────────────────────────
//
// Fluxo:
//   1. Frontend chama issuePlaybackToken(cameraId, fromIso, toIso)
//      → recebe { ticket, manifestUrl }
//   2. PlaybackPlayer consome `${BASE_URL}${manifestUrl}` no <video>
//      via hls.js. Cada segmento .ts dentro do manifest carrega o ticket.
//
// Ticket dura 30 min — operador revisa um dia inteiro tranquilo.

export interface PlaybackTokenResponse {
  ticket:      string
  manifestUrl: string  // path relativo, ex: "/playback/<id>/manifest.m3u8?ticket=..."
  fromIso:     string
  toIso:       string
}

export async function issuePlaybackToken(
  cameraId: string, fromIso: string, toIso: string,
): Promise<PlaybackTokenResponse> {
  const { data } = await api.post('/playback/token', { cameraId, fromIso, toIso })
  return data
}

export interface PlaybackTimelineResponse {
  cameraId:    string
  dayUtc:      string
  minutes:     1440
  /** Bitmap '0'|'1' por minuto. bitmap[m]==='1' → tem gravação no minuto m. */
  bitmap:      string
  coverageMin: number
}

/** Bitmap 1440-char dos minutos do dia com gravação. Usado no scrubber. */
export function usePlaybackTimeline(cameraId: string | null, day: string | null) {
  const url = cameraId && day
    ? `/playback/${cameraId}/timeline?day=${day}`
    : null
  return useSWR<PlaybackTimelineResponse>(url, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,  // novo dado a cada minuto (gravação avança)
  })
}

export interface PlaybackIndexResponse {
  days: { day: string; count: number }[]
}

/** Índice de dias com gravação (últimos 60 dias). Pra date picker. */
export function usePlaybackIndex(cameraId: string | null) {
  return useSWR<PlaybackIndexResponse>(
    cameraId ? `/playback/${cameraId}/index` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
}

// ── Pricing (público) ────────────────────────────────────────────────────
export interface PricingResponse {
  currency: 'BRL'
  period: 'month'
  tiers: { tier: 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM'; price: number }[]
  technical: { tier: 'STATIC_VISION' | 'STREAMING_ANALYTICS'; model: string }[]
}
export function usePricing() {
  return useSWR<PricingResponse>('/pricing', fetcher, { revalidateOnFocus: false })
}

// ── Cameras ──────────────────────────────────────────────────────────────
export function useCameras(filters?: Record<string, string | undefined>) {
  const qs = filters
    ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString()
    : ''
  return useSWR('/cameras' + qs, fetcher, { revalidateOnFocus: false, refreshInterval: 30_000 })
}
export function useCamera(id: string | null) {
  return useSWR(id ? `/cameras/${id}` : null, fetcher, { refreshInterval: 15_000 })
}
export function useCameraPresets() {
  return useSWR('/cameras/presets', fetcher, { revalidateOnFocus: false })
}
export function useCameraLogs(id: string | null, params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return useSWR(id ? `/cameras/${id}/logs${qs}` : null, fetcher, { refreshInterval: 10_000 })
}
export function useCameraStreamTests(id: string | null) {
  return useSWR(id ? `/cameras/${id}/stream-tests` : null, fetcher, { refreshInterval: 30_000 })
}

export async function createCamera(body: any) {
  const { data } = await api.post('/cameras', body); return data
}

// ── Users / Invites (Gap 4) ───────────────────────────────────────────────
export type AppRole =
  | 'SUPER_ADMIN' | 'ADMIN_GLOBAL'
  | 'INTEGRADOR_ADMIN' | 'INTEGRADOR_TECNICO'
  | 'CLIENTE_ADMIN' | 'CLIENTE_SUPERVISOR' | 'CLIENTE_OPERADOR' | 'CLIENTE_VIEWER'

export interface UserRow {
  id: string
  email: string
  name: string
  role: AppRole
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  integrador:   { id: string; name: string } | null
  clienteFinal: { id: string; name: string } | null
}

export function useUsers() {
  return useSWR<{ users: UserRow[]; total: number }>(
    '/users', fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
}

export interface InvitePayload {
  email:           string
  name:            string
  role:            'INTEGRADOR_TECNICO' | 'CLIENTE_ADMIN' | 'CLIENTE_OPERADOR' | 'CLIENTE_VIEWER'
  clienteFinalId?: string
  integradorId?:   string
}
export interface InviteResponse {
  user: UserRow
  invitation: {
    /** Senha mostrada UMA vez. Se emailSent=false, repassar manualmente. */
    tempPassword: string
    loginUrl:     string
    emailSent:    boolean
    emailReason:  string | null
  }
}
export async function inviteUser(payload: InvitePayload): Promise<InviteResponse> {
  const { data } = await api.post('/users/invite', payload)
  return data as InviteResponse
}

// Gap 3 — Sondar URL pré-criação (POST /cameras/probe).
// Retorna o mesmo shape que /cameras/:id/test mas sem persistir.
export interface ProbeResult {
  success:      boolean
  stage:        string
  resolution?:  string
  fps?:         number
  codec?:       string
  bitrateKbps?: number
  latencyMs?:   number
  errorCode?:   string
  errorMessage?:string
  rawOutput?:   string
}
export async function probeCameraUrl(url: string, timeoutMs?: number): Promise<ProbeResult> {
  const { data } = await api.post('/cameras/probe', { url, timeoutMs })
  return data as ProbeResult
}

// ─── Gap 5 — Clientes Finais (CRUD com commercialPlan) ───────────────────────
export type Vertical =
  | 'RETAIL' | 'SHOPPING' | 'EDUCATION' | 'INDUSTRY' | 'LOGISTICS'
  | 'PARKING' | 'CONDOMINIUM' | 'PUBLIC_SAFETY' | 'OTHER'

export interface ClienteFinalRow {
  id:             string
  name:           string
  tradeName?:     string | null
  cnpj?:          string | null
  email:          string
  phone?:         string | null
  city?:          string | null
  state?:         string | null
  vertical:       Vertical
  active:         boolean
  commercialPlan?: string | null
  // Portal white-label (CF.4)
  portalSlug?:     string | null
  primaryColor?:   string | null
  secondaryColor?: string | null
  logoUrl?:        string | null
  createdAt:      string
  updatedAt:      string
  integrador?:    { id: string; name: string }
  _count?:        { sites: number; users: number }
}
export interface ClienteFinalPayload {
  name:           string
  tradeName?:     string
  cnpj?:          string
  email:          string
  phone?:         string
  address?:       string
  city?:          string
  state?:         string
  country?:       string
  vertical:       Vertical
  logoUrl?:       string
  notifyEmail?:   string
  commercialPlan?:string
  // Portal white-label (CF.4)
  portalSlug?:     string
  primaryColor?:   string
  secondaryColor?: string
  integradorId?:  string  // só SUPER_ADMIN
}
export function useClientesFinais() {
  return useSWR<{ clientes: ClienteFinalRow[]; total: number }>(
    '/clientes-finais', fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
}
export async function createClienteFinal(payload: ClienteFinalPayload): Promise<{ cliente: ClienteFinalRow }> {
  const { data } = await api.post('/clientes-finais', payload); return data
}
export async function updateClienteFinal(id: string, payload: Partial<ClienteFinalPayload>): Promise<{ cliente: ClienteFinalRow }> {
  const { data } = await api.patch(`/clientes-finais/${id}`, payload); return data
}
export async function deactivateClienteFinal(id: string): Promise<void> {
  await api.delete(`/clientes-finais/${id}`)
}

// ─── Sprint CF.4 — Portal cliente-final (magic-link B2B2B) ────────────────
export interface PortalTokenRow {
  id:         string
  expiresAt:  string
  lastUsedAt: string | null
  singleUse:  boolean
  revoked:    boolean
  label:      string | null
  createdBy:  string
  createdAt:  string
  status:     'pending' | 'active' | 'consumed' | 'expired' | 'revoked'
}
export interface PortalTokenMintResponse {
  token: {
    id:        string
    plaintext: string  // ⚠️ aparece UMA VEZ — armazene/copie já
    magicLink: string
    expiresAt: string
    singleUse: boolean
    label:     string | null
    createdAt: string
  }
}
export async function mintPortalToken(
  clienteFinalId: string,
  opts: { ttlHours?: number; singleUse?: boolean; label?: string } = {},
): Promise<PortalTokenMintResponse> {
  const { data } = await api.post(`/clientes-finais/${clienteFinalId}/portal-token`, opts)
  return data
}
export function usePortalTokens(clienteFinalId: string | null) {
  return useSWR<{ tokens: PortalTokenRow[]; total: number }>(
    clienteFinalId ? `/clientes-finais/${clienteFinalId}/portal-tokens` : null,
    fetcher,
    { revalidateOnFocus: false },
  )
}
export async function revokePortalToken(clienteFinalId: string, tokenId: string): Promise<void> {
  await api.delete(`/clientes-finais/${clienteFinalId}/portal-tokens/${tokenId}`)
}

// ── Endpoints PÚBLICOS do portal (sem Bearer) ────────────────────────────
export interface PortalBranding {
  name:           string
  vertical:       string
  logoUrl:        string | null
  primaryColor:   string | null
  secondaryColor: string | null
  integradorName: string | null
}
export interface PortalExchangeResponse {
  token:     string
  role:      'CLIENTE_VIEWER'
  cliente:   { id: string; name: string; vertical: string; portalSlug: string | null }
  expiresIn: string
}
/**
 * Chamadas públicas — não usam o `api` (que injeta Bearer); usam axios cru
 * pra evitar interceptors de auth. baseURL idêntico ao do `api`.
 */
export async function fetchPortalBranding(slug: string): Promise<PortalBranding> {
  const { data } = await api.get(`/portal/branding/${encodeURIComponent(slug)}`, {
    // garantir sem Authorization header — interceptor é tolerante a 401 mas evita ruído.
    headers: { Authorization: '' },
  })
  return data
}
export async function exchangePortalToken(token: string): Promise<PortalExchangeResponse> {
  const { data } = await api.post('/portal/exchange', { token }, {
    headers: { Authorization: '' },
  })
  return data
}

// ─── Gap 6 — Auditoria (transparência da plataforma sobre o tenant) ──────────
export interface AuditEntry {
  id:           string
  action:       string
  resource:     string
  resourceId?:  string | null
  result?:      string | null
  ipAddress?:   string | null
  createdAt:    string
  metadataJson?:any
  superAdmin?:  { id: string; name?: string; email?: string } | null
  integrador?:  { id: string; name: string } | null
  clienteFinal?:{ id: string; name: string } | null
  user?:        { id: string; name: string; email: string; role: string } | null
}
export interface PlatformActionsResponse {
  logs:   AuditEntry[]
  total:  number
  window: { sinceIso: string; days: number }
  counts: Record<string, number>
}
export interface TimelineResponse {
  logs:   AuditEntry[]
  total:  number
  window: { sinceIso: string; days: number }
}
export function usePlatformActions(days = 30, action = '') {
  const qs = new URLSearchParams({ days: String(days) })
  if (action) qs.set('action', action)
  return useSWR<PlatformActionsResponse>(
    `/audit/platform-actions?${qs.toString()}`, fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
}
export function useAuditTimeline(days = 7, action = '') {
  const qs = new URLSearchParams({ days: String(days) })
  if (action) qs.set('action', action)
  return useSWR<TimelineResponse>(
    `/audit/timeline?${qs.toString()}`, fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  )
}
export async function updateCamera(id: string, body: any) {
  const { data } = await api.patch(`/cameras/${id}`, body); return data
}
export async function deleteCamera(id: string) {
  const { data } = await api.delete(`/cameras/${id}`); return data
}
export async function testCamera(id: string) {
  const { data } = await api.post(`/cameras/${id}/test`); return data
}
export async function snapshotCamera(id: string) {
  const { data } = await api.post(`/cameras/${id}/snapshot`); return data
}

// ── Live streaming ─────────────────────────────────────────────────────────
export interface LiveTokenResponse {
  ticket: string
  streamId: string
  liveMode: 'AUTO' | 'WHEP_ONLY' | 'MJPEG_ONLY' | 'DISABLED'
  iceServers: RTCIceServer[]
  camera: { id: string; name: string; resolution: string | null; fps: number | null }
}
export async function getLiveToken(
  cameraId: string,
  kind: 'whep' | 'mjpeg' | 'snapshot' = 'whep',
): Promise<LiveTokenResponse> {
  const { data } = await api.get(`/cameras/${cameraId}/live-token`, { params: { kind } })
  return data
}
export function getMjpegUrl(cameraId: string, ticket: string): string {
  return `${BASE_URL}/live/${cameraId}/mjpeg?ticket=${encodeURIComponent(ticket)}`
}
export function getWhepUrl(cameraId: string, ticket: string): string {
  return `${BASE_URL}/live/${cameraId}/whep?ticket=${encodeURIComponent(ticket)}`
}

/**
 * MediaMTX WHEP — fonte de baixa latência (SRT uplink + WebRTC saída).
 * Box deve estar pushando SRT para `srt.iacloud.com.br:8890`.
 */
export function getWhepMediamtxUrl(
  cameraId: string,
  ticket: string,
  quality: 'main' | 'sub' = 'main',
): string {
  return `${BASE_URL}/live/${cameraId}/whep-mediamtx?ticket=${encodeURIComponent(ticket)}&quality=${quality}`
}

export type LiveSourceKind = 'mediamtx' | 'go2rtc' | 'snapshot' | 'none'

export interface LiveAvailabilityResponse {
  cameraId: string
  preferred: LiveSourceKind
  sources: Record<'mediamtx' | 'go2rtc' | 'snapshot', {
    available: boolean
    latencyHint?: string
    reason?: string
  }>
}

export async function getLiveAvailability(cameraId: string): Promise<LiveAvailabilityResponse> {
  const { data } = await api.get(`/live/${cameraId}/availability`)
  return data
}

export async function createZone(cameraId: string, body: any) {
  const { data } = await api.post(`/cameras/${cameraId}/zones`, body); return data
}
export async function updateZone(cameraId: string, zoneId: string, body: any) {
  const { data } = await api.patch(`/cameras/${cameraId}/zones/${zoneId}`, body); return data
}
export async function deleteZone(cameraId: string, zoneId: string) {
  const { data } = await api.delete(`/cameras/${cameraId}/zones/${zoneId}`); return data
}

// ── Logs ─────────────────────────────────────────────────────────────────
export function useLogsSources() {
  return useSWR('/logs/sources', fetcher, { revalidateOnFocus: false })
}
export function useLogs(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString()
  return useSWR('/logs?' + qs, fetcher, { refreshInterval: 8_000 })
}
export function useLogsStats(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString()
  return useSWR('/logs/stats?' + qs, fetcher, { refreshInterval: 30_000 })
}

/**
 * Monta a URL de export CSV (incluindo Authorization via query `_t` para
 * funcionar com `window.open`/<a download> — SSE/download não enviam header).
 * Backend aceita o token nessa query como fallback do header Bearer.
 */
export function logsExportCsvUrl(params: Record<string, string>): string {
  const token = localStorage.getItem('icv_token')
  const qs = new URLSearchParams({ ...params, pageSize: '10000', ...(token ? { _t: token } : {}) }).toString()
  return `${BASE_URL}/logs/export.csv?${qs}`
}

/**
 * Purga logs antigos (SUPER_ADMIN only).
 * @param olderThanDays  retém apenas eventos mais novos que N dias
 * @param kind  'all' | 'camera' | 'system'
 */
export async function purgeLogs(olderThanDays: number, kind: 'all' | 'camera' | 'system' = 'all') {
  const qs = new URLSearchParams({ olderThanDays: String(olderThanDays), kind }).toString()
  const { data } = await api.delete('/logs/purge?' + qs)
  return data as { cutoff: string; cameraDeleted?: number; systemDeleted?: number }
}

// ── Faces ────────────────────────────────────────────────────────────────
export function useFaceIdentities(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return useSWR('/faces/identities' + qs, fetcher, { refreshInterval: 30_000 })
}
export function useFaceIdentity(id: string | null) {
  return useSWR(id ? `/faces/identities/${id}` : null, fetcher)
}
export function useFaceEvents(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return useSWR('/faces/events' + qs, fetcher, { refreshInterval: 15_000 })
}
export async function createFaceIdentity(body: any) {
  const { data } = await api.post('/faces/identities', body); return data
}
export async function updateFaceIdentity(id: string, body: any) {
  const { data } = await api.patch(`/faces/identities/${id}`, body); return data
}
export async function deleteFaceIdentity(id: string) {
  const { data } = await api.delete(`/faces/identities/${id}`); return data
}
export async function enrollFace(id: string, imageBase64: string) {
  const { data } = await api.post(`/faces/identities/${id}/enroll`, { imageBase64, autoCrop: true })
  return data
}
export async function deleteFaceEmbedding(embeddingId: string) {
  await api.delete(`/faces/embeddings/${embeddingId}`)
}
export async function matchFace(body: { imageBase64: string; clienteFinalId: string; topK?: number; minScore?: number }) {
  const { data } = await api.post('/faces/match', body); return data
}

// ── Plates ───────────────────────────────────────────────────────────────
export function usePlates(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return useSWR('/plates' + qs, fetcher, { refreshInterval: 30_000 })
}
export function usePlate(id: string | null) {
  return useSWR(id ? `/plates/${id}` : null, fetcher)
}
export function usePlateEvents(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return useSWR('/plates/events/list' + qs, fetcher, { refreshInterval: 15_000 })
}
export function usePlateStats(days = 7) {
  return useSWR(`/plates/stats/overview?days=${days}`, fetcher, { refreshInterval: 60_000 })
}
export async function createPlate(body: any) {
  const { data } = await api.post('/plates', body); return data
}
export async function updatePlate(id: string, body: any) {
  const { data } = await api.patch(`/plates/${id}`, body); return data
}
export async function deletePlate(id: string) { await api.delete(`/plates/${id}`) }

// ── Review ───────────────────────────────────────────────────────────────
export function useReviewItems(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  return useSWR('/review' + qs, fetcher, { refreshInterval: 10_000 })
}
export function useReviewItem(id: string | null) {
  return useSWR(id ? `/review/${id}` : null, fetcher)
}
export function useReviewStats(days = 7) {
  return useSWR(`/review/stats/overview?days=${days}`, fetcher, { refreshInterval: 30_000 })
}
export async function acknowledgeReview(id: string) {
  const { data } = await api.post(`/review/${id}/acknowledge`); return data
}
export async function resolveReview(id: string, resolution?: string) {
  const { data } = await api.post(`/review/${id}/resolve`, { resolution }); return data
}
export async function bulkAckReview(ids: string[]) {
  const { data } = await api.post(`/review/bulk-ack`, { ids }); return data
}
export async function dismissReview(id: string) { await api.delete(`/review/${id}`) }

// ── Utilization (Contratado × Utilizado · Sprint 2.3) ───────────────────
// Endpoint backend planejado: GET /bi/utilization?days=N
// Resposta esperada: array de { integradorId, integradorName, integradorEmail,
// clientesCount, modules: [{ moduleId, contracted, events, cameras, costBrl }] }
// Enquanto não publica, a UtilizationPage roda em SYNTHETIC_MODE (hash det.).
export interface UtilizationModuleCell {
  moduleId: string
  contracted: boolean
  events: number
  cameras: number
  costBrl: number
}
export interface UtilizationRowApi {
  integradorId: string
  integradorName: string
  integradorEmail: string
  clientesCount: number
  modules: UtilizationModuleCell[]
}
export function useUtilization(days = 30) {
  return useSWR<{ periodDays: number; data: UtilizationRowApi[] }>(
    `/bi/utilization?days=${days}`, fetcher,
    { ...DEFAULT_SWR, refreshInterval: 60_000, shouldRetryOnError: false },
  )
}

// ── Smart City — Vertical Cidades Inteligentes (Sprint 2.4) ──────────────
// Endpoints backend planejados (módulo SMART_CITY):
//   GET  /bi/smart-city/overview?days=N   → { totalEvents, vehicles24h, ... }
//   GET  /bi/smart-city/hotspots?days=N   → { rows: HotspotRow[] }
//   GET  /bi/smart-city/hotlist           → { rows: HotlistEntry[] }
//   GET  /bi/smart-city/traffic?days=N    → { rows: TrafficRow[] }
//   POST /bi/smart-city/track-plate       → { plate, hits[], confidence }
// Enquanto não publica, SmartCityHubPage roda em SYNTHETIC_MODE (hash det.).
export interface SmartCityOverview {
  periodDays: number
  totalEvents: number
  vehicles24h: number
  hotspotsActive: number
  hotlistAlerts24h: number
  topZones: { zone: string; count: number; deltaPct: number | null }[]
}
export interface SmartCityHotspotRow {
  zone: string
  events: number
  baseline: number
  zScore: number     // > 3 = anomaly
  category: string   // VIOLATION | LOITERING | CROWD | ...
}
export interface SmartCityHotlistEntry {
  id: string
  plate: string
  category: 'STOLEN' | 'WANTED' | 'BLACKLIST' | 'WATCHLIST'
  source: string                // manual | ssp_api | detran | csv | ...
  active: boolean
  notes?: string
  lastHitAt?: string | null
  createdAt: string
}
export interface SmartCityTrafficRow {
  via: string
  vehiclesPerHour: number
  peakHour: number              // 0-23
  deltaWoWPct: number | null    // semana sobre semana
  isAnomaly: boolean            // 3σ
}
export interface SmartCityTrackingHit {
  cameraId: string
  cameraName: string
  capturedAt: string
  confidence: number            // 0..1
  imageUrl?: string | null
}

export function useSmartCityOverview(days = 7) {
  return useSWR<SmartCityOverview>(
    `/bi/smart-city/overview?days=${days}`, fetcher,
    { ...DEFAULT_SWR, refreshInterval: 60_000, shouldRetryOnError: false },
  )
}
export function useSmartCityHotspots(days = 7) {
  return useSWR<{ rows: SmartCityHotspotRow[] }>(
    `/bi/smart-city/hotspots?days=${days}`, fetcher,
    { ...DEFAULT_SWR, refreshInterval: 60_000, shouldRetryOnError: false },
  )
}
export function useSmartCityHotlist() {
  return useSWR<{ rows: SmartCityHotlistEntry[] }>(
    '/bi/smart-city/hotlist', fetcher,
    { ...DEFAULT_SWR, refreshInterval: 30_000, shouldRetryOnError: false },
  )
}
export function useSmartCityTraffic(days = 7) {
  return useSWR<{ rows: SmartCityTrafficRow[] }>(
    `/bi/smart-city/traffic?days=${days}`, fetcher,
    { ...DEFAULT_SWR, refreshInterval: 60_000, shouldRetryOnError: false },
  )
}
export async function trackPlate(plate: string, days = 7) {
  const { data } = await api.post('/bi/smart-city/track-plate', { plate, days })
  return data as { plate: string; hits: SmartCityTrackingHit[]; confidence: number }
}

// ── User profile · mosaicos do mosaic wall ────────────────────────────────
// Endpoint backend `/me/mosaics` ainda não implementado — fonte de verdade
// é localStorage (gerenciado pelo MosaicWall). Stubs no-op evitam 404 ruidoso.
export async function fetchMyMosaics<T = any>(): Promise<T | null> {
  return null
}
export async function saveMyMosaics<T = any>(_prefs: T): Promise<boolean> {
  return false
}

// ── Semantic Search ──────────────────────────────────────────────────────
export async function semanticQuery(body: any) {
  const { data } = await api.post('/semantic-search/query', body); return data
}
export async function semanticImage(body: any) {
  const { data } = await api.post('/semantic-search/image', body); return data
}
export function useSemanticStats() {
  return useSWR('/semantic-search/stats', fetcher, { refreshInterval: 60_000 })
}

export interface QuotaItem {
  resource: string
  used: number
  limit: number | null
  unit: string
}
export interface QuotaStatus {
  summary: {
    cycle: string
    cycleLabel: string
    vertexCalls: number
    storageGb: number
    events: number
    cameras: number
  }
  items: QuotaItem[]
  s3: {
    enabled: boolean
    bucket?: string
    endpoint?: string
    region?: string
    usedBytes: number
    usedGb: number
    quotaGb: number
    objectsCount: number
  }
}
export function useQuotaStatus() {
  return useSWR<QuotaStatus>('/quota/status', fetcher, { refreshInterval: 60_000 })
}

/**
 * /quota/me — versão tenant-scoped. Backend filtra por integradorId/
 * clienteFinalId conforme o JWT. Shape compatível com QuotaStatus +
 * campos extras: `scope` (PLATFORM | INTEGRADOR | CLIENTE_FINAL) e
 * `hardLimits` (só preenchido para INTEGRADOR).
 *
 * UI canônica: usar SEMPRE este endpoint pra exibir consumo do usuário
 * logado. /quota/status fica reservado para super-admin precisar de visão
 * agregada platform-wide explicitamente.
 */
export interface QuotaMeStatus extends QuotaStatus {
  scope: 'PLATFORM' | 'INTEGRADOR' | 'CLIENTE_FINAL'
  hardLimits: null | {
    vision:    { used: number; limit: number; pct: number; blocked: boolean }
    streaming: { usedMinutes: number; limitMinutes: number; pct: number; blocked: boolean }
    periodEnd: string
  }
}
export function useQuotaMe() {
  return useSWR<QuotaMeStatus>('/quota/me', fetcher, { refreshInterval: 60_000 })
}

// ── Integradores admin (Sprint U.2.1) ─────────────────────────────────────
// Backend: vsaas-backend/src/routes/integradores.ts (mount: /admin/integradores)
// Apenas SUPER_ADMIN. Hoje expõe GET/POST/PATCH + suspend/cockpit endpoints.
// DELETE permanente não existe — usar PATCH active=false ou suspend.
export interface IntegradorRow {
  id: string
  name: string
  tradeName?: string | null
  email: string
  phone?: string | null
  active: boolean
  createdAt: string
  cfSubdomain?: string | null
  maxEdgeNodes?: number | null
  edgeNodesUsed?: number
  edgeNodesOnline?: number
  edgeNodesAvailable?: number | null
  users?: { admins: number; tecnicos: number; clientes: number; total: number }
  pendingApprovals?: number
  _count: { clienteFinais: number }
}

// Impersonation (Sprint Tenant List)
export async function impersonateIntegrador(integradorId: string, reason?: string) {
  const { data } = await api.post('/auth/impersonate', { integradorId, reason })
  return data as { token: string; user: { id: string; email: string; role: string } }
}

export function useIntegradores() {
  return useSWR<{ integradores: IntegradorRow[]; total: number }>(
    '/admin/integradores', fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false },
  )
}

export interface TenantsGlobalStats {
  integradores: { total: number; ativos: number; suspensos: number }
  clientes:     { total: number; ativos: number }
  sites:        number
  cameras:      number
  usuarios:     number
  edgeBoxes:    { total: number; online: number; offline: number; degraded: number; pendingApproval: number; suspended: number }
  modulesEnabled: number
  pendingApprovals: number
}
export function useTenantsGlobalStats() {
  return useSWR<TenantsGlobalStats>('/admin/integradores/stats', fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false })
}

export interface IntegradorQuotaStatus {
  integrador: { id: string; name: string }
  quota: {
    staticVisionMonthlyLimit:  number
    staticVisionMonthlyUsed:   number
    streamingMinutesLimit:     number
    streamingMinutesUsed:      number
    periodStart:               string
    periodEnd:                 string
    [k: string]: any
  }
}

export function useIntegradorQuota(id: string | null) {
  return useSWR<IntegradorQuotaStatus>(
    id ? `/admin/integradores/${id}/quota` : null,
    fetcher, { refreshInterval: 30_000 },
  )
}

export interface CreateIntegradorPayload {
  name: string
  tradeName?: string
  cnpj?: string
  email: string
  password: string
  phone?: string
  gcpProjectId?: string
  staticVisionMonthlyLimit?: number
  streamingMinutesLimit?: number
}

export async function createIntegrador(payload: CreateIntegradorPayload) {
  const { data } = await api.post('/admin/integradores', payload)
  return data as { id: string; name: string; email: string }
}

export interface UpdateIntegradorPayload {
  name?: string
  tradeName?: string | null
  cnpj?: string | null
  phone?: string | null
  email?: string
  website?: string | null
  logoUrl?: string | null
  gcpProjectId?: string | null
  billingCycle?: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'
  storageRetainDays?: number
  active?: boolean
  maxEdgeNodes?: number | null
  staticVisionMonthlyLimit?: number
  streamingMinutesLimit?: number
}

export async function updateIntegrador(id: string, payload: UpdateIntegradorPayload) {
  const { data } = await api.patch(`/admin/integradores/${id}`, payload)
  return data
}

// ── Integrador Cockpit APIs (SuperAdmin) ──────────────────────────────────────

export interface IntegradorOverview {
  integrador: {
    id: string
    name: string
    tradeName: string | null
    cnpj: string | null
    email: string
    phone: string | null
    active: boolean
    createdAt: string
  }
  kpis: {
    clientes: number
    usuarios: number
    sites: number
    cameras: number
    modules: number
  }
  edgeNodes: {
    total: number
    online: number
    offline: number
    degraded: number
    provisioning: number
    maxAllowed: number | null
    available: number | null
  }
  quota: {
    staticVisionMonthlyUsed: number
    staticVisionMonthlyLimit: number
    streamingMinutesUsed: number
    streamingMinutesLimit: number
  } | null
  recentActivity: { action: string; target: string; at: string }[]
}

export function useIntegradorOverview(id: string | null) {
  return useSWR<IntegradorOverview>(
    id ? `/admin/integradores/${id}/overview` : null,
    fetcher, { refreshInterval: 30_000 }
  )
}

export interface IntegradorClient {
  id: string
  name: string
  email: string
  active: boolean
  createdAt: string
  _count: { users: number; sites: number; cameras: number }
}

export function useIntegradorClients(id: string | null) {
  return useSWR<{ clients: IntegradorClient[]; total: number }>(
    id ? `/admin/integradores/${id}/clients` : null,
    fetcher, DEFAULT_SWR
  )
}

// ── Onda 1: árvore hierárquica completa (substitui múltiplas chamadas) ──
export interface IntegradorTreeCamera {
  id: string
  name: string
  deploymentMode: 'EDGE_BOX' | 'CLOUD_DIRECT'
  edgeNodeId: string | null
  latitude?: number | null
  longitude?: number | null
}
export interface IntegradorTreeEdgeNode {
  id: string
  name: string
  status: string
  lastHeartbeat: string | null
  firmwareVersion: string | null
  cameraCount: number
}
export interface IntegradorTreeSite {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  latitude: number | null
  longitude: number | null
  timezone: string | null
  counts: { cameras: number; edgeNodes: number }
  edgeNodes?: IntegradorTreeEdgeNode[]
  standaloneCameras?: IntegradorTreeCamera[]
}
export interface IntegradorTreeCliente {
  id: string
  name: string
  tradeName: string | null
  email: string
  active: boolean
  createdAt: string
  counts: { sites: number; users: number; cameras: number; edgeNodes: number; edgeNodesOnline: number }
  sites?: IntegradorTreeSite[]
}
export interface IntegradorTreeResponse {
  integrador: { id: string; name: string; tradeName: string | null; email: string; active: boolean }
  summary: { integrador: string; clientes: number; sites: number; cameras: number; edgeNodes: number; edgeNodesOnline: number }
  clientes: IntegradorTreeCliente[]
  depth: number
}

export function useIntegradorTree(id: string | null, depth: 1 | 2 | 3 = 3) {
  return useSWR<IntegradorTreeResponse>(
    id ? `/admin/integradores/${id}/tree?depth=${depth}` : null,
    fetcher, { refreshInterval: 60_000 }
  )
}

export interface IntegradorUser {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  lastLogin: string | null
  clienteFinal: { id: string; name: string } | null
}

export function useIntegradorUsers(id: string | null) {
  return useSWR<{ users: IntegradorUser[]; total: number }>(
    id ? `/admin/integradores/${id}/users` : null,
    fetcher, DEFAULT_SWR
  )
}

// User CRUD (Sprint R2)
export interface UpdateUserPayload {
  name?: string
  email?: string
  role?: string
  active?: boolean
}
export async function updateUser(id: string, payload: UpdateUserPayload) {
  const { data } = await api.patch(`/users/${id}`, payload)
  return data
}

// Sites CRUD (Sprint R3)
export async function updateSite(id: string, payload: any) {
  const { data } = await api.patch(`/sites/${id}`, payload)
  return data
}

// Sprint R7: License approval workflow
export async function suspendEdgeNode(id: string, reason?: string) {
  const { data } = await api.post(`/edge-nodes/${id}/suspend`, { reason })
  return data as { ok: boolean; edgeNodeId: string; status: string; reason: string | null }
}
export async function resumeEdgeNode(id: string) {
  const { data } = await api.post(`/edge-nodes/${id}/resume`, {})
  return data as { ok: boolean; edgeNodeId: string; status: string; licenseKey: string; warning: string }
}
// Logs Explorer (Sprint Logs)
export interface LogActor { id: string; name: string | null; email: string; role: string; kind: 'user'|'superadmin' }
export interface LogEntry {
  id: string
  /** Tabela de origem: 'audit' (AuditLog) | 'edge-connection' | 'system' | 'camera' | 'ingest' */
  source?: 'audit' | 'edge-connection' | 'system' | 'camera' | 'ingest'
  timestamp: string
  action: string
  resource: string
  resourceId: string | null
  result: string | null
  ipAddress: string | null
  userAgent: string | null
  metadata: any
  actor: LogActor | null
  tenant: { kind: string; id: string; name: string } | null
  category: string
  severity: 'info'|'warning'|'error'|'critical'
}
export interface LogsExplorerResponse {
  logs: LogEntry[]
  total: number
  page: number
  pages: number
  limit: number
  window: { sinceIso: string; untilIso: string }
  aggregations: {
    countsByCategory: Record<string, number>
    countsBySeverity: Record<string, number>
    topActors: { name: string; email: string; count: number }[]
    sparkline24h: number[]
  }
}
export interface LogsExplorerQuery {
  startDate?: string
  endDate?: string
  days?: number
  categories?: string[]
  severities?: string[]
  actorEmail?: string
  resource?: string
  resourceId?: string
  action?: string
  ip?: string
  result?: 'SUCCESS'|'BLOCKED'|'ERROR'
  search?: string
  /** Restringe a auditoria a um Integrador específico (TenantCockpit). */
  integradorId?: string
  page?: number
  limit?: number
}
export function useLogsExplorer(q: LogsExplorerQuery) {
  const p = new URLSearchParams()
  Object.entries(q).forEach(([k, v]) => {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return
    p.set(k, Array.isArray(v) ? v.join(',') : String(v))
  })
  return useSWR<LogsExplorerResponse>(`/audit/explorer?${p.toString()}`, fetcher, { refreshInterval: 30_000 })
}
export function useResourceTimeline(resource: string | null, resourceId: string | null) {
  return useSWR<{ logs: LogEntry[]; total: number; resource: any }>(
    resource && resourceId ? `/audit/resource/${resource}/${resourceId}` : null,
    fetcher,
  )
}

export function usePendingEdgeApprovals() {
  return useSWR<{ items: any[]; total: number; byStatus: Record<string, number> }>(
    '/approvals?status=PENDING&action=PROVISION_EDGE_NODE',
    fetcher,
    { refreshInterval: 30_000 },
  )
}
// approveRequest/rejectRequest já existem no módulo de approvals (linha 2082+)

// ── Sales / Comercial Hub ────────────────────────────────────────────────
export interface SalesUser {
  id: string; userId: string; name: string; email: string
  role: 'SDR'|'AE'|'CS'|'MANAGER'|'DIRECTOR'
  avatar: string | null; hireDate: string; active: boolean
}
export function useSalesTeam() {
  return useSWR<{ team: SalesUser[]; total: number }>('/sales/team', fetcher, { refreshInterval: 60_000 })
}
export function useSalesRanking(month?: string) {
  const q = month ? `?month=${month}` : ''
  return useSWR<any>('/sales/team/ranking' + q, fetcher, { refreshInterval: 60_000 })
}
export async function createSalesUser(data: any) {
  const r = await api.post('/sales/team', data); return r.data
}

export interface SalesGoal {
  id: string; salesUserId: string; period: string
  metric: 'CALLS'|'QUALIFIED_LEADS'|'DEMOS_SENT'|'DEALS_CLOSED'|'CLOSED_MRR'|'REVENUE'
  target: number; actual: number
}
export function useSalesGoals(salesUserId?: string) {
  const q = salesUserId ? `?salesUserId=${salesUserId}` : ''
  return useSWR<{ goals: SalesGoal[] }>('/sales/goals' + q, fetcher, { refreshInterval: 60_000 })
}
export async function upsertSalesGoal(data: any) {
  const r = await api.post('/sales/goals', data); return r.data
}

export interface SalesActivity {
  id: string; salesUserId: string; leadId: string | null; integradorId: string | null
  opportunityId: string | null
  type: 'CALL'|'EMAIL'|'WHATSAPP'|'MEETING'|'NOTE'|'TASK'|'PROPOSAL_SENT'|'DEMO_DONE'
  durationSec: number | null; outcome: string | null; notes: string | null
  createdAt: string
  salesUser?: { id: string; name: string; role: string; avatar: string | null }
}
export function useSalesActivities(opts?: { salesUserId?: string; leadId?: string; integradorId?: string; limit?: number }) {
  const p = new URLSearchParams()
  Object.entries(opts ?? {}).forEach(([k, v]) => { if (v != null) p.set(k, String(v)) })
  return useSWR<{ activities: SalesActivity[]; total: number }>('/sales/activities?' + p, fetcher, { refreshInterval: 30_000 })
}
export async function logSalesActivity(data: any) {
  const r = await api.post('/sales/activities', data); return r.data
}

export interface SalesOpportunity {
  id: string
  type: 'NEW_LEAD'|'CROSS_SELL'|'UPSELL'|'RENEWAL'
  status: 'OPEN'|'WON'|'LOST'|'STALLED'
  leadId: string | null; integradorId: string | null
  ownerId: string | null
  title: string; description: string | null
  modulesProposed: string[]; estimatedMrr: number | null
  probability: number | null; reasonAi: string | null
  closeDate: string | null; closedAt: string | null
  createdAt: string
  owner?: { id: string; name: string; role: string }
  tenantName?: string | null; leadName?: string | null
}
export function useSalesOpportunities(opts?: { status?: string; type?: string; ownerId?: string }) {
  const p = new URLSearchParams()
  Object.entries(opts ?? {}).forEach(([k, v]) => { if (v) p.set(k, String(v)) })
  return useSWR<{ opportunities: SalesOpportunity[]; total: number; totalValue: number; counts: any }>(
    '/sales/opportunities?' + p, fetcher, { refreshInterval: 30_000 },
  )
}
export async function createOpportunity(data: any) {
  const r = await api.post('/sales/opportunities', data); return r.data
}
export async function updateOpportunity(id: string, data: any) {
  const r = await api.patch(`/sales/opportunities/${id}`, data); return r.data
}
export async function autoDetectOpportunities() {
  const r = await api.post('/sales/opportunities/auto-detect', {}); return r.data
}

export interface LeadScoreData { leadId: string; score: number; reasonsJson: any[]; computedAt: string }
export function useLeadScore(leadId: string | null) {
  return useSWR<LeadScoreData>(leadId ? `/sales/score/${leadId}` : null, fetcher)
}
export async function recomputeAllScores() {
  const r = await api.post('/sales/score/recompute-all', {}); return r.data
}

export interface SalesAsset {
  id: string; title: string; type: string; funnelStage: string | null
  url: string | null; body: string | null; description: string | null
  active: boolean; createdAt: string
}
export function useSalesAssets() {
  return useSWR<{ assets: SalesAsset[] }>('/sales/assets', fetcher)
}
export async function createSalesAsset(data: any) {
  const r = await api.post('/sales/assets', data); return r.data
}

export async function assignLead(leadId: string, salesUserId?: string, reason?: string) {
  const r = await api.post('/sales/leads/assign', { leadId, salesUserId, reason }); return r.data
}

export interface ExecStatsFilter {
  days?: number
  vendedorId?: string
  team?: 'all' | 'SDR' | 'HUNTER' | 'CLOSER' | 'AE' | 'CS' | 'MANAGER' | 'DIRECTOR'
  vertical?: string
  kind?: 'INTEGRADOR' | 'CLIENTE_FINAL'
  compare?: boolean
}
export function useSalesExecutiveStats(filter: ExecStatsFilter = {}) {
  const p = new URLSearchParams()
  p.set('days', String(filter.days ?? 30))
  if (filter.vendedorId) p.set('vendedorId', filter.vendedorId)
  if (filter.team) p.set('team', filter.team)
  if (filter.vertical) p.set('vertical', filter.vertical)
  if (filter.kind) p.set('kind', filter.kind)
  p.set('compare', String(filter.compare ?? true))
  return useSWR<any>(`/sales/executive-stats?${p}`, fetcher, { refreshInterval: 60_000 })
}

export function usePriorityActions(salesUserId?: string) {
  const q = salesUserId ? `?salesUserId=${salesUserId}` : ''
  return useSWR<any>('/sales/priority-actions' + q, fetcher, { refreshInterval: 30_000 })
}

export function useEligibleUsers() {
  return useSWR<{ users: { id: string; name: string; email: string; role: string }[] }>(
    '/sales/team/eligible-users', fetcher,
  )
}

// ── Sprint S1: Sales RBAC + Config ──────────────────────────────────────────
export type PermLevel = 'NONE' | 'VIEW' | 'EDIT' | 'ADMIN'
export const SALES_SCREENS = ['executive','pipeline','demos','opportunities','activities','team','materials','modules','config'] as const
export type SalesScreen = (typeof SALES_SCREENS)[number]

export function useMySalesPermissions() {
  return useSWR<{ screens: string[]; permissions: Record<SalesScreen, PermLevel> }>(
    '/sales/me/permissions', fetcher, { refreshInterval: 120_000 },
  )
}
export function useSalesConfig() {
  return useSWR<any>('/sales/config', fetcher, { refreshInterval: 60_000 })
}
export async function updateSalesConfig(data: any) {
  const r = await api.put('/sales/config', data); return r.data
}
export function useSalesPermissionsMatrix() {
  return useSWR<{ screens: string[]; defaults: any[]; overrides: any[] }>(
    '/sales/permissions', fetcher, { refreshInterval: 60_000 },
  )
}
export async function updateRolePermissions(role: string, perms: { screen: string; level: PermLevel }[]) {
  const r = await api.put(`/sales/permissions/role/${role}`, { perms }); return r.data
}
export async function setUserPermissionOverride(salesUserId: string, screen: string, level: PermLevel) {
  const r = await api.post('/sales/permissions/override', { salesUserId, screen, level }); return r.data
}
export async function deletePermissionOverride(id: string) {
  const r = await api.delete(`/sales/permissions/override/${id}`); return r.data
}
// ── Notify prefs ────────────────────────────────────────────────────────────
export type NotifyChannel = 'push' | 'email' | 'whatsapp' | 'sse'
export interface NotifyPrefs {
  id: string
  pushEnabled: boolean
  emailEnabled: boolean
  whatsappEnabled: boolean
  whatsappPhone: string | null
  quietHoursStart: number
  quietHoursEnd: number
  eventChannels: Record<string, NotifyChannel[]>
  dailyDigest: boolean
}
export function useNotifyPrefs() {
  return useSWR<NotifyPrefs>('/notify/prefs', fetcher, { refreshInterval: 0 })
}
export async function updateNotifyPrefs(data: Partial<NotifyPrefs>) {
  const r = await api.put('/notify/prefs', data); return r.data
}
export async function sendNotifyTest(channels: NotifyChannel[]) {
  const r = await api.post('/notify/test', { channels }); return r.data
}
export function useNotifyLog(limit = 100) {
  return useSWR<{ items: any[]; total: number }>(`/notify/log?limit=${limit}`, fetcher, { refreshInterval: 30_000 })
}
export async function runNotifyDetection() {
  const r = await api.post('/notify/admin/run-detection', {}); return r.data
}

// Aliases para compatibilidade com componentes pré-existentes.
export const sendTestNotify = sendNotifyTest
export const useNotifyHistory = useNotifyLog

export function useCycleTime(days = 90) {
  return useSWR<{ days: number; stages: { stage: string; avgDays: number; sampleCount: number }[]; bottleneck: any; totalLeads: number }>(
    `/leads/cycle-time?days=${days}`, fetcher, { refreshInterval: 300_000 },
  )
}

export function useUserEffectivePermissions(salesUserId: string | null) {
  return useSWR<{ salesUserId: string; role: string; screens: string[]; effective: Record<string, { level: PermLevel; source: 'override'|'default'|'none' }> }>(
    salesUserId ? `/sales/permissions/user/${salesUserId}` : null, fetcher,
  )
}

// Edge Node actions (Sprint R5)
export async function getEdgeNodeLicenseKey(id: string) {
  const { data } = await api.get(`/edge-nodes/${id}/license-key`)
  return data as { edgeNodeId: string; name: string; serialNumber: string; licenseKey: string; status: string }
}
export async function rotateEdgeNodeToken(id: string, opts?: { sendEmail?: boolean; technicianEmail?: string }) {
  const { data } = await api.post(`/edge-nodes/${id}/rotate-token`, opts ?? {})
  return data as { edgeNodeId: string; licenseKey: string; warning: string }
}
export async function decommissionEdgeNode(id: string) {
  const { data } = await api.delete(`/edge-nodes/${id}`)
  return data as { ok: boolean; deletedId: string }
}
export async function deleteSite(id: string) {
  const { data } = await api.delete(`/sites/${id}`)
  return data as { ok: boolean; deactivatedId: string }
}
// createSite já está exportado acima (linha 222)
export async function deleteUser(id: string) {
  const { data } = await api.delete(`/users/${id}`)
  return data as { ok: boolean; deactivatedId: string }
}
export async function resetUserPassword(id: string) {
  const { data } = await api.post(`/users/${id}/reset-password`)
  return data as { ok: boolean; tempPassword: string; emailSent: boolean; emailReason: string | null }
}
export async function resendUserInvite(id: string) {
  const { data } = await api.post(`/users/${id}/resend-invite`)
  return data as { ok: boolean; tempPassword: string; emailSent: boolean; emailReason: string | null }
}

export interface IntegradorBox {
  id: string
  name: string
  serialNumber: string | null
  status: string
  lastSeen: string | null
  site: { id: string; name: string } | null
  clienteFinal: { id: string; name: string } | null
  licenseKey: string | null
  licenseExpiresAt: string | null
  licensedModules: string[]
}

export function useIntegradorBoxes(id: string | null) {
  return useSWR<{ boxes: IntegradorBox[]; total: number; licensed: number }>(
    id ? `/admin/integradores/${id}/boxes` : null,
    fetcher, DEFAULT_SWR
  )
}

export interface IntegradorStorage {
  type: 'r2' | 'custom' | 'none'
  bucket: string | null
  retainDays: number
  totalBytes: number
  objectCount: number
  recordingCount: number
  totalCameras: number
  r2Enabled: boolean
  r2Endpoint: string | null
  buckets: { name: string; bytes: number; objects: number }[]
  byClient: { clientId: string; clientName: string; bytes: number; cameras: number }[]
}

export function useIntegradorStorage(id: string | null) {
  return useSWR<IntegradorStorage>(
    id ? `/admin/integradores/${id}/storage` : null,
    fetcher, { refreshInterval: 60_000 }
  )
}

export interface IntegradorLog {
  id: string
  action: string
  targetType: string
  targetId: string
  userId: string
  userName: string
  details: Record<string, unknown> | null
  createdAt: string
}

export function useIntegradorLogs(id: string | null, opts?: { page?: number; limit?: number; action?: string }) {
  const params = new URLSearchParams()
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.action) params.set('action', opts.action)
  const qs = params.toString()
  return useSWR<{ logs: IntegradorLog[]; total: number; page: number; pages: number }>(
    id ? `/admin/integradores/${id}/logs${qs ? `?${qs}` : ''}` : null,
    fetcher, DEFAULT_SWR
  )
}

export interface IntegradorModuleInfo {
  module: string
  enabled: boolean
  enabledAt: string | null
}

export function useIntegradorModulesInfo(id: string | null) {
  return useSWR<{ modules: IntegradorModuleInfo[] }>(
    id ? `/admin/integradores/${id}/modules` : null,
    fetcher, DEFAULT_SWR
  )
}

export async function suspendIntegrador(id: string, suspend: boolean, reason?: string) {
  const { data } = await api.post(`/admin/integradores/${id}/suspend`, { suspend, reason })
  return data as { success: boolean; active: boolean }
}

// ── Módulos hooks ─────────────────────────────────────────────────────────────

export function useModuleCatalog() {
  return useSWR('/modules/catalog', fetcher, { revalidateOnFocus: false })
}

export function useMyModules() {
  return useSWR('/modules/me', fetcher, DEFAULT_SWR)
}

export function useEffectiveModules() {
  return useSWR('/modules/effective', fetcher, DEFAULT_SWR)
}

// Admin: todos integradores + módulos
export function useAdminIntegradoresModules() {
  return useSWR('/modules/admin/integradores', fetcher, DEFAULT_SWR)
}

// Admin: módulos de um integrador específico
export function useIntegradorModules(integradorId: string | null) {
  return useSWR(integradorId ? `/modules/admin/integradores/${integradorId}` : null, fetcher, DEFAULT_SWR)
}

// Integrador: clientes + módulos
export function useClientesModules() {
  return useSWR('/modules/clientes', fetcher, DEFAULT_SWR)
}

// Integrador: módulos de um cliente específico
export function useClienteFinalModules(clienteFinalId: string | null) {
  return useSWR(clienteFinalId ? `/modules/clientes/${clienteFinalId}` : null, fetcher, DEFAULT_SWR)
}

// Mutations
export async function updateIntegradorModules(integradorId: string, modules: { module: string; enabled: boolean }[]) {
  const { data } = await api.put(`/modules/admin/integradores/${integradorId}`, { modules })
  return data
}

export async function updateClienteFinalModules(clienteFinalId: string, modules: { module: string; enabled: boolean }[]) {
  const { data } = await api.put(`/modules/clientes/${clienteFinalId}`, { modules })
  return data
}

// Login
export async function login(email: string, password: string) {
  const { data } = await api.post('/auth/login', { email, password })
  localStorage.setItem('icv_token', data.token)
  localStorage.setItem('icv_role',  data.role)
  if (data.mustChangePassword) {
    localStorage.setItem('icv_must_change_pw', '1')
  } else {
    localStorage.removeItem('icv_must_change_pw')
  }
  return data
}

// ── Auth / Perfil ────────────────────────────────────────────────────────
export interface MeResponse {
  kind: 'SUPER_ADMIN' | 'INTEGRADOR' | 'USER'
  id: string
  name: string
  email: string
  createdAt: string
  role?: string
  tradeName?: string | null
  cnpj?: string | null
  phone?: string | null
  website?: string | null
  integrador?: { id: string; name: string; tradeName?: string | null } | null
  clienteFinal?: { id: string; name: string; tradeName?: string | null } | null
}
export function useMe() {
  return useSWR<MeResponse>('/auth/me', fetcher, { revalidateOnFocus: false })
}
export async function updateMe(patch: { name?: string; phone?: string }) {
  const { data } = await api.patch('/auth/me', patch)
  return data as MeResponse
}
export async function changePassword(current: string, next: string) {
  const { data } = await api.post('/auth/change-password', { current, next })
  return data
}

// ── Sprint Q.1 — WebPush ──────────────────────────────────────────────────
export interface VapidKeyResp { publicKey: string; simulated: boolean }

export async function getVapidPublicKey(): Promise<VapidKeyResp> {
  const { data } = await api.get('/push/vapid-public-key')
  return data
}

export interface SubscribePayload {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string
}

export async function subscribePush(payload: SubscribePayload) {
  const { data } = await api.post('/push/subscribe', payload)
  return data as { id: string; active: boolean }
}

export async function unsubscribePush(p256dh: string) {
  const { data } = await api.delete(`/push/subscribe/${encodeURIComponent(p256dh)}`)
  return data as { unsubscribed: number }
}

export interface PushSubscriptionItem {
  id: string
  endpoint: string
  userAgent: string | null
  lastUsedAt: string | null
  failureCount: number
  createdAt: string
}

export function usePushSubscriptions() {
  return useSWR<{ items: PushSubscriptionItem[] }>('/push/subscriptions', fetcher, { revalidateOnFocus: false })
}

export async function sendTestPush(payload?: { title?: string; body?: string }) {
  const { data } = await api.post('/push/test', payload ?? {})
  return data as { sent: number; failed: number; expired: number }
}

// ── Sprint S — Semantic Triggers ──────────────────────────────────────────
export type TriggerSourceType = 'IMAGE' | 'TEXT' | 'THUMBNAIL_REF'
export type TriggerActionType = 'WEBHOOK' | 'NOTIFY' | 'RECORD' | 'SIREN' | 'REVIEW_FLAG'

export type TriggerAction =
  | { type: 'WEBHOOK'; url: string; secret?: string }
  | { type: 'NOTIFY' }
  | { type: 'RECORD' }
  | { type: 'SIREN'; sirenId?: string }
  | { type: 'REVIEW_FLAG' }

export interface TriggerListItem {
  id: string
  name: string
  description: string | null
  enabled: boolean
  sourceType: TriggerSourceType
  threshold: number
  cooldownSec: number
  hitsCount: number
  lastHitAt: string | null
  createdAt: string
  clienteFinalId: string
}

export function useTriggers() {
  return useSWR<{ items: TriggerListItem[] }>('/triggers', fetcher, { ...DEFAULT_SWR, refreshInterval: 30_000 })
}

export interface CreateTriggerPayload {
  clienteFinalId: string
  name: string
  description?: string
  sourceType: TriggerSourceType
  sourceText?: string
  sourceImageBase64?: string
  sourceImageUrl?: string
  cameraIds?: string[]
  threshold?: number
  cooldownSec?: number
  actions: TriggerAction[]
  scheduleJson?: unknown
}

export async function createTrigger(payload: CreateTriggerPayload) {
  const { data } = await api.post('/triggers', payload)
  return data as { id: string; name: string; threshold: number; embeddingDim: number; embeddingProvider: string }
}

export interface TriggerDetail extends TriggerListItem {
  embeddingProvider: string
  embeddingModel: string
  embeddingDim: number
  actionsJson: TriggerAction[]
  cameraIdsJson: string[] | null
  scheduleJson: unknown
  hits: Array<{
    id: string
    cameraId: string
    score: number
    snapshotKey: string | null
    capturedAt: string
    delivered: boolean
  }>
}

export function useTrigger(id?: string) {
  return useSWR<TriggerDetail>(id ? `/triggers/${id}` : null, fetcher, { revalidateOnFocus: false })
}

export async function patchTrigger(id: string, patch: Partial<{
  enabled: boolean
  name: string
  description: string
  threshold: number
  cooldownSec: number
  actions: TriggerAction[]
  cameraIds: string[] | null
}>) {
  const { data } = await api.patch(`/triggers/${id}`, patch)
  return data as { id: string; enabled: boolean }
}

export async function deleteTrigger(id: string) {
  await api.delete(`/triggers/${id}`)
}

export async function testTrigger(id: string, body: { text?: string; imageBase64?: string }) {
  const { data } = await api.post(`/triggers/${id}/test`, body)
  return data as { score: number; threshold: number; wouldMatch: boolean; provider: string }
}

// ── Sprint E.2 — MQTT status / catálogo ──────────────────────────────────
//
// Tipos refletem EXATAMENTE o que o backend retorna em vsaas-backend/src/routes/mqtt.ts.
// Versões antigas declaravam {brokerConfigured, libInstalled, pid} — backend nunca
// devolveu isso, era *type-fiction*. Consertado em Sprint U.1.
export interface MqttStatus {
  connected: boolean
  brokerUrl: string | null     // null quando IACV_MQTT_BROKER_URL não setado (modo NOOP)
  clientId: string
}

export function useMqttStatus() {
  return useSWR<MqttStatus>('/mqtt/status', fetcher, { ...DEFAULT_SWR, refreshInterval: 10_000 })
}

export interface MqttTopicEntry {
  topic: string
  retain: boolean
  example: string
}

export interface MqttCatalogResponse {
  prefix: string                // 'iacv/<integradorId>/'
  topics: MqttTopicEntry[]
}

export function useMqttTopicsCatalog() {
  return useSWR<MqttCatalogResponse>('/mqtt/topics-catalog', fetcher, { revalidateOnFocus: false })
}

export interface MqttTestResponse {
  published: boolean
  topic: string                 // tópico final completo, com prefixo iacv/<int>/
  brokerConnected: boolean
}

export async function mqttTestPublish(payload: { topic?: string; payload?: unknown }): Promise<MqttTestResponse> {
  const { data } = await api.post('/mqtt/test', payload)
  return data as MqttTestResponse
}

// ── Sprint U.2.3 — Review Alert Rules ────────────────────────────────────
// CRUD de regras de revisão automática (CameraAlertRule no backend).
// Endpoints: GET /review/rules/list, POST /review/rules,
//            PATCH /review/rules/:id, DELETE /review/rules/:id

export type ReviewTriggerType =
  | 'ZONE_OCCUPANCY' | 'LOITERING' | 'TRIPWIRE' | 'PPE_VIOLATION'
  | 'FACE_MATCH'     | 'FACE_UNKNOWN' | 'LPR_BLACKLIST' | 'AUDIO_DETECT'
  | 'MOTION_AREA'    | 'OBJECT_CLASS' | 'QUEUE_OVERFLOW'

export type ReviewSeverity = 'DETECTION' | 'ALERT' | 'CRITICAL'

export interface ReviewRule {
  id: string
  cameraId: string
  name: string
  description: string | null
  enabled: boolean
  triggerType: ReviewTriggerType
  conditionsJson: Record<string, any>
  scheduleJson: Record<string, any> | null
  cooldownSec: number | null
  severity: ReviewSeverity
  notifyEmail: string | null
  notifyWebhookUrl: string | null
  notifyPushEnabled: boolean
  notifyMqttTopic: string | null
  createdAt: string
  updatedAt: string
  camera?: { id: string; name: string }
}

export interface ReviewRulesResponse {
  items: ReviewRule[]
}

export function useReviewRules(cameraId?: string) {
  const qs = cameraId ? `?cameraId=${cameraId}` : ''
  return useSWR<ReviewRulesResponse>('/review/rules/list' + qs, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
  })
}

export interface CreateReviewRulePayload {
  cameraId: string
  name: string
  description?: string | null
  enabled?: boolean
  triggerType: ReviewTriggerType
  conditions: Record<string, any>
  schedule?: Record<string, any>
  cooldownSec?: number
  severity?: ReviewSeverity
  notifyEmail?: string | null
  notifyWebhookUrl?: string | null
  notifyPushEnabled?: boolean
  notifyMqttTopic?: string | null
}

export async function createReviewRule(body: CreateReviewRulePayload): Promise<ReviewRule> {
  const { data } = await api.post('/review/rules', body)
  return data
}

export async function updateReviewRule(
  id: string,
  patch: Partial<Omit<CreateReviewRulePayload, 'cameraId'>>,
): Promise<ReviewRule> {
  const { data } = await api.patch(`/review/rules/${id}`, patch)
  return data
}

export async function deleteReviewRule(id: string): Promise<void> {
  await api.delete(`/review/rules/${id}`)
}

// ── E-mail Config (SMTP + Templates) ─────────────────────────────────────────

export interface SmtpConfig {
  host:        string
  port:        number
  secure:      boolean
  user:        string
  pass:        string
  fromName:    string
  fromAddress: string
  configured:  boolean
}

export interface EmailTemplate {
  name:    string
  label:   string
  subject: string
  body:    string
}

export function useEmailSmtpConfig() {
  return useSWR<SmtpConfig>('/config/email/smtp', fetcher, { revalidateOnFocus: false })
}

export async function saveEmailSmtpConfig(cfg: Omit<SmtpConfig, 'configured'>): Promise<{ ok: boolean }> {
  const { data } = await api.put('/config/email/smtp', cfg)
  return data
}

export async function testEmailSmtp(to: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post('/config/email/smtp/test', { to })
  return data
}

export function useEmailTemplates() {
  return useSWR<{ templates: EmailTemplate[] }>('/config/email/templates', fetcher, { revalidateOnFocus: false })
}

export async function saveEmailTemplate(name: string, patch: { subject: string; body: string }): Promise<{ ok: boolean }> {
  const { data } = await api.put(`/config/email/templates/${name}`, patch)
  return data
}

export async function resetEmailTemplate(name: string): Promise<{ ok: boolean }> {
  const { data } = await api.delete(`/config/email/templates/${name}`)
  return data
}

// ── Alert Recipients ──────────────────────────────────────────────────────────

export interface AlertRecipient {
  id:                   string
  email:                string
  name:                 string | null
  active:               boolean
  rcvCritical:          boolean
  rcvWarning:           boolean
  rcvInfo:              boolean
  rcvCameraDown:        boolean
  rcvCameraUp:          boolean
  rcvTriggerFire:       boolean
  rcvDigest:            boolean
  escalateToIntegrador: boolean
  quietStart:           string | null
  quietEnd:             string | null
  clienteFinalId:       string | null
  integradorId:         string | null
  createdAt:            string
}

export function useAlertRecipients(clienteFinalId?: string) {
  const qs = clienteFinalId ? `?clienteFinalId=${clienteFinalId}` : ''
  return useSWR<{ recipients: AlertRecipient[]; total: number }>(
    `/alert-recipients${qs}`,
    fetcher,
    { revalidateOnFocus: false },
  )
}

export async function saveAlertRecipient(
  data: Partial<AlertRecipient> & { email: string },
  id?: string,
): Promise<AlertRecipient> {
  if (id) {
    const resp = await api.put(`/alert-recipients/${id}`, data)
    return resp.data
  }
  const resp = await api.post('/alert-recipients', data)
  return resp.data
}

export async function deleteAlertRecipient(id: string): Promise<void> {
  await api.delete(`/alert-recipients/${id}`)
}

export async function testAlertRecipient(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post(`/alert-recipients/${id}/test`)
  return data
}

// ── Alert Config ──────────────────────────────────────────────────────────────

export interface AlertConfig {
  clienteFinalId:              string
  cooldownCameraDown:          number
  cooldownTrigger:             number
  cooldownCameraUp:            number
  offlineGraceSec:             number
  maxEmailsPerHour:            number
  maxEmailsPerDay:             number
  digestEnabled:               boolean
  digestTime:                  string
  digestTimezone:              string
  integradorForceReceiveCritical: boolean
}

export function useAlertConfig(clienteFinalId?: string) {
  const qs = clienteFinalId ? `?clienteFinalId=${clienteFinalId}` : ''
  return useSWR<AlertConfig>(`/alert-config${qs}`, fetcher, { revalidateOnFocus: false })
}

export async function saveAlertConfig(
  data: Partial<Omit<AlertConfig, 'clienteFinalId'>>,
  clienteFinalId?: string,
): Promise<AlertConfig> {
  const qs = clienteFinalId ? `?clienteFinalId=${clienteFinalId}` : ''
  const resp = await api.put(`/alert-config${qs}`, data)
  return resp.data
}

// ── Alert Deliveries ──────────────────────────────────────────────────────────

export interface AlertDelivery {
  id:             string
  alertKey:       string
  recipientEmail: string
  subject:        string
  status:         string
  errorMsg:       string | null
  eventType:      string
  severity:       string
  cameraId:       string | null
  clienteFinalId: string | null
  metadataJson:   Record<string, string> | null
  sentAt:         string
}

export function useAlertDeliveries(params?: {
  clienteFinalId?: string
  cameraId?:       string
  eventType?:      string
  status?:         string
  limit?:          number
  offset?:         number
}) {
  const qs = new URLSearchParams()
  if (params?.clienteFinalId) qs.set('clienteFinalId', params.clienteFinalId)
  if (params?.cameraId)       qs.set('cameraId', params.cameraId)
  if (params?.eventType)      qs.set('eventType', params.eventType)
  if (params?.status)         qs.set('status', params.status)
  if (params?.limit)          qs.set('limit', String(params.limit))
  if (params?.offset)         qs.set('offset', String(params.offset))
  const key = `/alert-deliveries${qs.toString() ? `?${qs}` : ''}`
  return useSWR<{
    items:    AlertDelivery[]
    total:    number
    limit:    number
    offset:   number
    byStatus: Record<string, number>
  }>(key, fetcher, { revalidateOnFocus: false, refreshInterval: 30_000 })
}

export async function retryAlertDelivery(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post(`/alert-deliveries/${id}/retry`)
  return data
}

// ── Demo Invites ──────────────────────────────────────────────────────────────

export interface DemoInvite {
  id:               string
  leadId:           string
  tokenHash:        string
  status:           'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  expiresAt:        string
  targetKind:       'INTEGRADOR' | 'CLIENTE_FINAL'
  suggestedPlan:    string | null
  hostIntegradorId: string | null
  notes:            string | null
  createdByUserId:  string | null
  consumedAt:       string | null
  createdAt:        string
  lead: {
    id:           string
    contactName:  string
    contactEmail: string
    companyName:  string | null
    kind:         string
    status:       string
  }
}

export function useDemoInvites() {
  return useSWR<{ items: DemoInvite[]; total: number }>(
    '/demo-invites',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30_000 },
  )
}

export async function revokeDemoInvite(id: string): Promise<{ id: string; status: string }> {
  const { data } = await api.post(`/demo-invites/${id}/revoke`)
  return data
}

// ── Approvals (hooks for ApprovalsPage) ──────────────────────────────────────

export interface ApprovalRequest {
  id:                string
  action:            string
  status:            'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'EXPIRED'
  requestedByUserId: string
  payloadJson:       Record<string, unknown>
  resultJson:        Record<string, unknown> | null
  reason:            string | null
  rejectedReason:    string | null
  decidedByUserId:   string | null
  decidedAt:         string | null
  executedAt:        string | null
  expiresAt:         string
  createdAt:         string
  updatedAt:         string
}

export function useApprovals(params?: { status?: string; action?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  if (params?.action) qs.set('action', params.action)
  if (params?.limit)  qs.set('limit',  String(params.limit))
  if (params?.offset) qs.set('offset', String(params.offset))
  const key = `/approvals${qs.toString() ? `?${qs}` : ''}`
  return useSWR<{ items: ApprovalRequest[]; total: number; byStatus: Record<string, number> }>(
    key, fetcher, { revalidateOnFocus: false, refreshInterval: 30_000 },
  )
}

export async function approveRequest(id: string): Promise<ApprovalRequest> {
  const { data } = await api.post(`/approvals/${id}/approve`)
  return data
}

export async function rejectRequest(id: string, reason: string): Promise<ApprovalRequest> {
  const { data } = await api.post(`/approvals/${id}/reject`, { reason })
  return data
}

export async function createApproval(payload: {
  action: string
  payloadJson: Record<string, unknown>
  reason?: string
}): Promise<ApprovalRequest> {
  const { data } = await api.post('/approvals', payload)
  return data
}

// ── Lead Follow-ups (CRM activity timeline) ──────────────────────────────────

export type FollowUpType = 'NOTE' | 'CALL' | 'EMAIL' | 'WHATSAPP' | 'MEETING' | 'TASK'

export interface LeadFollowUp {
  id:          string
  leadId:      string
  type:        FollowUpType
  content:     string
  dueDate:     string | null
  completed:   boolean
  createdById: string
  createdAt:   string
  updatedAt:   string
}

export function useLeadFollowUps(leadId: string | null) {
  return useSWR<{ items: LeadFollowUp[] }>(
    leadId ? `/leads/${leadId}/follow-ups` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30_000 },
  )
}

export async function createFollowUp(
  leadId: string,
  body: { type?: FollowUpType; content: string; dueDate?: string | null },
): Promise<LeadFollowUp> {
  const { data } = await api.post(`/leads/${leadId}/follow-ups`, body)
  return data
}

export async function updateFollowUp(
  leadId: string,
  fid: string,
  body: { content?: string; dueDate?: string | null; completed?: boolean },
): Promise<LeadFollowUp> {
  const { data } = await api.patch(`/leads/${leadId}/follow-ups/${fid}`, body)
  return data
}

export async function deleteFollowUp(leadId: string, fid: string): Promise<void> {
  await api.delete(`/leads/${leadId}/follow-ups/${fid}`)
}

// ── Mapa Sinótico (Plantas Baixas) ──

export interface FloorPlanCamera {
  id:         string
  cameraId:   string
  xPct:       number
  yPct:       number
  label:      string | null
  camera: {
    id:               string
    name:             string
    status:           string
    lastSnapshotUrl:  string | null
    go2rtcStreamId:   string | null
    whepUrl:          string | null
  }
}

export interface FloorPlan {
  id:          string
  name:        string
  siteId:      string | null
  imageUrl:    string
  imageWidth:  number | null
  imageHeight: number | null
  createdAt:   string
  _count?:     { cameras: number }
  cameras?:    FloorPlanCamera[]
}

export function useFloorPlans(siteId?: string | null) {
  const qs = siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''
  return useSWR<{ floorPlans: FloorPlan[] }>(
    `/floor-plans${qs}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )
}

export function useFloorPlan(id: string | null) {
  return useSWR<FloorPlan>(
    id ? `/floor-plans/${id}` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 10_000 },
  )
}

export async function createFloorPlan(body: {
  name: string; imageUrl: string; siteId?: string; imageWidth?: number; imageHeight?: number;
}): Promise<FloorPlan> {
  const { data } = await api.post('/floor-plans', body)
  return data
}

export async function updateFloorPlan(id: string, body: Partial<{
  name: string; imageUrl: string; siteId: string | null; imageWidth: number; imageHeight: number;
}>): Promise<FloorPlan> {
  const { data } = await api.patch(`/floor-plans/${id}`, body)
  return data
}

export async function deleteFloorPlan(id: string): Promise<void> {
  await api.delete(`/floor-plans/${id}`)
}

export async function saveFloorPlanCameras(
  floorPlanId: string,
  cameras: { cameraId: string; xPct: number; yPct: number; label?: string }[],
): Promise<void> {
  await api.put(`/floor-plans/${floorPlanId}/cameras`, { cameras })
}

export async function removeFloorPlanCamera(floorPlanId: string, cameraId: string): Promise<void> {
  await api.delete(`/floor-plans/${floorPlanId}/cameras/${cameraId}`)
}

export async function uploadFloorPlanImage(file: Blob, filename: string): Promise<{ imageUrl: string; width: number; height: number }> {
  const form = new FormData()
  form.append('image', file, filename)
  const { data } = await api.post('/floor-plans/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// ── Recording Segments ───────────────────────────────────────────────────
//
// Cada segmento representa um chunk contínuo de gravação para uma câmera.
// O backend devolve `sizeBytes` como string (BigInt serializado) — o consumer
// converte com Number/BigInt conforme necessidade.
export interface RecordingSegment {
  id:          string
  cameraId:    string
  startedAt:   string   // ISO 8601 UTC
  endedAt:     string   // ISO 8601 UTC
  durationSec: number
  hasMotion:   boolean
  hasEvent:    boolean
  sizeBytes:   string   // BigInt serializado como string
  spriteUrl:   string | null
  fps:         number
}

export interface RecordingSegmentsResponse {
  segments: RecordingSegment[]
}

export interface UseRecordingSegmentsOpts {
  hasMotion?:      boolean
  hasEvent?:       boolean
  /** Polling interval em ms. 0 desliga (default). */
  refreshInterval?: number
}

/**
 * Lista segmentos de gravação numa janela de tempo. Use ISO 8601 UTC.
 * `cameraId` falsy desativa o fetch (compatível com seleção tardia).
 */
export function useRecordingSegments(
  cameraId: string | null | undefined,
  from:     Date | string | null | undefined,
  to:       Date | string | null | undefined,
  opts:     UseRecordingSegmentsOpts = {},
) {
  const fromIso = from instanceof Date ? from.toISOString() : from
  const toIso   = to   instanceof Date ? to.toISOString()   : to

  const qs = new URLSearchParams()
  if (cameraId) qs.set('cameraId', cameraId)
  if (fromIso)  qs.set('from', fromIso)
  if (toIso)    qs.set('to',   toIso)
  if (opts.hasMotion !== undefined) qs.set('hasMotion', String(opts.hasMotion))
  if (opts.hasEvent  !== undefined) qs.set('hasEvent',  String(opts.hasEvent))

  const key = (cameraId && fromIso && toIso) ? `/recordings/segments?${qs}` : null

  return useSWR<RecordingSegmentsResponse>(key, fetcher, {
    refreshInterval: opts.refreshInterval ?? 0,
    revalidateOnFocus: false,
  })
}

// ── Bookmarks ────────────────────────────────────────────────────────────

export type BookmarkAutoType = 'MANUAL' | 'MOTION' | 'EVENT' | 'DOWNLOAD' | 'EXPORT'

export interface Bookmark {
  id:        string
  cameraId:  string
  segmentId: string | null
  title:     string
  color:     string   // hex (#rrggbb)
  startAt:   string   // ISO 8601 UTC
  endAt:     string | null
  notes:     string | null
  autoType:  BookmarkAutoType
  createdAt: string
}

export interface BookmarksResponse {
  bookmarks: Bookmark[]
}

export function useBookmarks(
  cameraId: string | null | undefined,
  from:     Date | string | null | undefined,
  to:       Date | string | null | undefined,
) {
  const fromIso = from instanceof Date ? from.toISOString() : from
  const toIso   = to   instanceof Date ? to.toISOString()   : to

  const qs = new URLSearchParams()
  if (cameraId) qs.set('cameraId', cameraId)
  if (fromIso)  qs.set('from', fromIso)
  if (toIso)    qs.set('to',   toIso)

  const key = (cameraId && fromIso && toIso) ? `/bookmarks?${qs}` : null

  return useSWR<BookmarksResponse>(key, fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  })
}

export interface CreateBookmarkBody {
  cameraId:  string
  title:     string
  color:     string
  startAt:   string | Date
  endAt?:    string | Date | null
  notes?:    string | null
  segmentId?: string | null
}

export async function createBookmark(body: CreateBookmarkBody): Promise<Bookmark> {
  const payload = {
    ...body,
    startAt: body.startAt instanceof Date ? body.startAt.toISOString() : body.startAt,
    endAt:   body.endAt   instanceof Date ? body.endAt.toISOString()   : body.endAt ?? undefined,
  }
  const { data } = await api.post('/bookmarks', payload)
  return data
}

export async function updateBookmark(
  id: string,
  body: Partial<Omit<CreateBookmarkBody, 'cameraId'>>,
): Promise<Bookmark> {
  const payload: Record<string, unknown> = { ...body }
  if (payload.startAt instanceof Date) payload.startAt = (payload.startAt as Date).toISOString()
  if (payload.endAt   instanceof Date) payload.endAt   = (payload.endAt   as Date).toISOString()
  const { data } = await api.patch(`/bookmarks/${id}`, payload)
  return data
}

export async function deleteBookmark(id: string): Promise<void> {
  await api.delete(`/bookmarks/${id}`)
}

// ── Recording Schedule ───────────────────────────────────────────────────

export type RecordingScheduleMode =
  | 'ALWAYS'
  | 'MOTION'
  | 'EVENT'
  | 'MOTION_AND_EVENT'
  | 'DISABLED'

export interface RecordingScheduleEntry {
  id?:       string
  dayOfWeek: number  // 0=Dom..6=Sab, 7=todos
  hourStart: number  // 0-23
  hourEnd:   number  // 1-24
  mode:      RecordingScheduleMode
}

export interface RecordingScheduleResponse {
  cameraId: string
  entries:  RecordingScheduleEntry[]
  total:    number
}

export function useRecordingSchedule(cameraId: string | null) {
  return useSWR<RecordingScheduleResponse>(
    cameraId ? `/cameras/${cameraId}/recording-schedule` : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )
}

export async function saveRecordingSchedule(
  cameraId: string,
  entries: Omit<RecordingScheduleEntry, 'id'>[],
): Promise<RecordingScheduleResponse> {
  const { data } = await api.put(`/cameras/${cameraId}/recording-schedule`, { entries })
  return data
}

export async function clearRecordingSchedule(cameraId: string): Promise<void> {
  await api.delete(`/cameras/${cameraId}/recording-schedule`)
}

// ── Detections / Motion search ────────────────────────────────────────────

export interface DetectionZone {
  x: number; y: number; w: number; h: number
}

export interface DetectionFrameRow {
  id:         string
  cameraId:   string
  segmentId:  string | null
  timestamp:  string
  objectType: string
  bboxX:      number
  bboxY:      number
  bboxW:      number
  bboxH:      number
  confidence: number | null
  trackId:    string | null
}

export async function searchMotionInZones(body: {
  cameraId:    string
  from:        string | Date
  to:          string | Date
  zones:       DetectionZone[]
  objectTypes?: string[]
}): Promise<{ frames: DetectionFrameRow[]; total: number }> {
  const payload: Record<string, unknown> = { ...body }
  if (payload.from instanceof Date) payload.from = (payload.from as Date).toISOString()
  if (payload.to   instanceof Date) payload.to   = (payload.to   as Date).toISOString()
  const { data } = await api.post('/detections/zone-search', payload)
  return data
}

// ── Export Audit ─────────────────────────────────────────────────────────

export interface ExportAuditRow {
  id:            string
  userId:        string | null
  userEmail:     string | null
  cameraIds:     string[]
  fromAt:        string | null
  toAt:          string | null
  exportType:    'SNAPSHOT' | 'RECORDING' | 'BULK' | 'MOSAIC' | 'PRINT'
  fileSizeBytes: string | null
  fileCount:     number
  destination:   string | null
  certificateId: string | null
  createdAt:     string
}

export function useExportAudit(filters?: { cameraId?: string; userId?: string; from?: string; to?: string }) {
  const qs = filters
    ? '?' + new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString()
    : ''
  return useSWR<{ exports: ExportAuditRow[]; total: number }>(
    `/export-audit${qs}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 30_000 },
  )
}

// ── Media Certificate verify ─────────────────────────────────────────────

export async function verifyCertificate(body: {
  signature?: string; certificateId?: string; sha256: string
}): Promise<{ valid: boolean; certificate: any | null }> {
  const { data } = await api.post('/certificates/verify', body)
  return data
}

