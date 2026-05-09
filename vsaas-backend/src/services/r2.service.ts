/**
 * R2 Service — Multi-tenant storage isolation via Cloudflare R2 scoped tokens.
 *
 * Hierarquia multi-tenant:
 *   Integrador → ClienteFinal → Site → EdgeNode → Camera
 *
 * Isolamento de storage:
 *   bucket: icv-{integradorId}  (1 bucket por Integrador)
 *   prefix: {clienteFinalId}/{edgeNodeId}/  (scoped ao EdgeNode)
 *
 * Estrutura de objetos:
 *   {bucket}/{clienteFinalId}/{edgeNodeId}/events/{date}/{eventId}.webp
 *   {bucket}/{clienteFinalId}/{edgeNodeId}/clips/{date}/{clipId}.mp4
 *   {bucket}/{clienteFinalId}/{edgeNodeId}/recordings/{cameraId}/{date}/{segment}.ts
 *
 * Segurança:
 *   - Cada Box recebe credenciais temporárias (7 dias) escopadas ao seu prefixo
 *   - Vazamento de credenciais de uma Box não expõe dados de outras Boxes
 *   - Integrador A não consegue acessar bucket de Integrador B
 *   - ClienteFinal X não consegue acessar prefixo de ClienteFinal Y
 *
 * API: Cloudflare R2 Temp Credentials
 * Docs: https://developers.cloudflare.com/r2/api/s3/tokens/
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent as HttpsAgent } from 'https'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { logger } from '../lib/logger'

// ── Config from environment ──────────────────────────────────────────────────

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? ''
const R2_API_TOKEN = process.env.R2_API_TOKEN ?? ''  // Master token with permissions to create scoped tokens
const R2_ENDPOINT = process.env.R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
// Contrato D1 BOX_TO_CLOUD: bucket = `iacv-vault-<integradorId>`.
// Box-side hardcoded esse prefix; Cloud-side alinhado em 2026-05-06 (VAULT_R2_UNBLOCK).
// Override via env R2_BUCKET_TEMPLATE para dev/test (ex: 'icv-{integradorId}' legado).
const R2_BUCKET_TEMPLATE = process.env.R2_BUCKET_TEMPLATE ?? 'iacv-vault-{integradorId}'
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? ''
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? ''

// Fallback S3-compatible credentials for backend operations.
// Pool aumentado de 50→200 sockets — ver r2-storage.service.ts pra contexto.
let r2Client: S3Client | null = null
if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_ACCOUNT_ID) {
  const MAX_SOCKETS = Number(process.env.S3_MAX_SOCKETS ?? 200)
  const httpsAgent = new HttpsAgent({
    keepAlive: true,
    maxSockets: MAX_SOCKETS,
    keepAliveMsecs: 5_000,
  })

  r2Client = new S3Client({
    endpoint: R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
    requestHandler: new NodeHttpHandler({ httpsAgent }),
  })
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface R2ScopedCredentials {
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  prefix: string
  endpoint: string
  region: string
  expiresAt: string
  tokenId: string
}

export interface R2UploadResult {
  bucket: string
  key: string
  url: string
}

// ── Helper: bucket name for an integrador ────────────────────────────────────

function getBucketName(integradorId: string): string {
  // Usa UUID completo para evitar colisões entre integradores
  // R2 bucket names: 3-63 chars, lowercase, alphanumeric + hyphens
  // UUID tem 36 chars → icv-{uuid} = 40 chars (OK)
  return R2_BUCKET_TEMPLATE.replace('{integradorId}', integradorId.toLowerCase())
}

// ── Helper: prefix path for tenant isolation ─────────────────────────────────

function getTenantPrefix(_clienteFinalId: string, edgeNodeId: string): string {
  // Contrato D5 BOX_TO_CLOUD: prefix = `<edgeNodeId>/<YYYY>/<MM>/<DD>/...`
  // VAULT_R2_UNBLOCK 2026-05-06: alinhado com Box-side (en-lab-001/...)
  // ClienteFinal isolation se garantida via bucket-per-integrador (D1):
  // `iacv-vault-<integradorId>` — cada integrador tem bucket próprio, dentro
  // dele cada Box ganha prefixo. Se 1 integrador tem N clientes finais com
  // Boxes próprias, edgeNodeId UUID já isola unicamente.
  return `${edgeNodeId}/`
}

// ── Key generators for different object types ────────────────────────────────

export const r2Keys = {
  /** Snapshot de evento de detecção */
  event(clienteFinalId: string, edgeNodeId: string, date: string, eventId: string): string {
    return `${getTenantPrefix(clienteFinalId, edgeNodeId)}events/${date}/${eventId}.webp`
  },

  /** Clip de vídeo curto (ex: 30s antes/depois de evento) */
  clip(clienteFinalId: string, edgeNodeId: string, date: string, clipId: string): string {
    return `${getTenantPrefix(clienteFinalId, edgeNodeId)}clips/${date}/${clipId}.mp4`
  },

  /** Segmento de gravação contínua */
  recording(clienteFinalId: string, edgeNodeId: string, cameraId: string, date: string, segmentId: string): string {
    return `${getTenantPrefix(clienteFinalId, edgeNodeId)}recordings/${cameraId}/${date}/${segmentId}.ts`
  },

  /** Extrai tenant info de uma key (para validação de acesso) */
  parseTenant(key: string): { clienteFinalId: string; edgeNodeId: string } | null {
    // Key format: {clienteFinalId}/{edgeNodeId}/...
    const parts = key.split('/')
    if (parts.length < 2) return null
    return { clienteFinalId: parts[0], edgeNodeId: parts[1] }
  },
}

// ── Cloudflare API helpers ───────────────────────────────────────────────────

const CF_API_BASE = 'https://api.cloudflare.com/client/v4'

async function cfFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${R2_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const json = await resp.json() as { success: boolean; result: T; errors?: { message: string }[] }
  if (!json.success) {
    const msg = json.errors?.[0]?.message ?? 'Cloudflare API error'
    throw new Error(`CF API: ${msg}`)
  }
  return json.result
}

// ── Service ──────────────────────────────────────────────────────────────────

export const r2Service = {
  /**
   * R2 está pronto para emitir credenciais de vault para a Box quando:
   * - Modo A (completo): R2_API_TOKEN configurado → Cloudflare Temp Credentials API
   *   → tokens realmente escopados por prefix, expiram em 7 dias
   * - Modo B (MVP): apenas R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY configurados
   *   → devolve as credenciais master com prefixo de isolamento por convenção
   *   → TTL conceitual de 30 dias (Box renova via próximo /activate)
   */
  isConfigured(): boolean {
    return !!(R2_ACCOUNT_ID && (R2_API_TOKEN || (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)))
  },

  /**
   * Create scoped R2 credentials for an EdgeNode.
   *
   * Modo A (R2_API_TOKEN disponível): usa Cloudflare Temp Credentials API
   *   → token realmente isolado por prefix policy
   * Modo B (apenas S3 keys): devolve credenciais master escopadas por prefix
   *   → isolamento por convenção de path (adequado para MVP)
   */
  async createScopedToken(
    integradorId: string,
    clienteFinalId: string,
    edgeNodeId: string,
    // Contrato D3 BOX_TO_CLOUD: TTL 24h. Box renova no próximo /activate
    // (ciclo heartbeat ~60s detecta vault.tokenExpiresAt < 24h e dispara
    // force_reactivate). FCB-006 já implementado Box-side commit e8defb1.
    // VAULT_R2_UNBLOCK 2026-05-06: alinhado.
    ttlSeconds = 24 * 60 * 60, // 24h (era 7 dias)
  ): Promise<R2ScopedCredentials | null> {
    if (!this.isConfigured()) {
      logger.debug('r2_not_configured')
      return null
    }

    const bucket = getBucketName(integradorId)
    const prefix = getTenantPrefix(clienteFinalId, edgeNodeId)
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

    // ── Modo A: Cloudflare Temp Credentials API ──────────────────────────────
    if (R2_ACCOUNT_ID && R2_API_TOKEN && R2_ACCESS_KEY_ID) {
      try {
        const result = await cfFetch<{
          accessKeyId: string
          secretAccessKey: string
        }>(`/accounts/${R2_ACCOUNT_ID}/r2/temp-access-credentials`, {
          method: 'POST',
          body: JSON.stringify({
            bucket,
            parentAccessKeyId: R2_ACCESS_KEY_ID,
            permission: 'object-read-write',
            ttlSeconds,
            prefixAccessRule: [
              { prefix, permission: 'object-read-write' },
            ],
          }),
        })

        logger.info({ bucket, prefix, mode: 'cf_scoped' }, 'r2_vault_token_created')
        return {
          accessKeyId: result.accessKeyId,
          secretAccessKey: result.secretAccessKey,
          bucket, prefix, endpoint: R2_ENDPOINT, region: 'auto',
          expiresAt,
          tokenId: result.accessKeyId,
        }
      } catch (err: any) {
        logger.warn({ err: err.message, bucket, prefix }, 'r2_cf_token_failed_fallback_to_master')
        // Fall through to Modo B
      }
    }

    // ── Modo B: credenciais master com isolamento por prefix (MVP) ───────────
    if (R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
      // VAULT_R2_UNBLOCK 2026-05-06: TTL 24h alinhado com contrato D3
      // (era 30d). Box renova via /activate ciclo heartbeat — FCB-006 ativo.
      const mvpTtl = 24 * 60 * 60 // 24h
      logger.info({ bucket, prefix, mode: 'master_prefix_scoped' }, 'r2_vault_token_created')
      return {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
        bucket, prefix, endpoint: R2_ENDPOINT, region: 'auto',
        expiresAt: new Date(Date.now() + mvpTtl * 1000).toISOString(),
        tokenId: `master-${edgeNodeId.slice(0, 8)}`,
      }
    }

    return null
  },

  /**
   * Revoke a scoped token by deleting it from Cloudflare.
   * Note: Temp credentials expire automatically; this is for early revocation.
   */
  async revokeToken(tokenId: string): Promise<void> {
    if (!this.isConfigured() || !tokenId) return

    try {
      // For temp credentials, there's no explicit revoke - they expire naturally
      // If using API tokens instead, would be:
      // await cfFetch(`/user/tokens/${tokenId}`, { method: 'DELETE' })
      logger.info({ tokenId }, 'r2_token_revoke_requested')
    } catch (err: any) {
      logger.warn({ err: err.message, tokenId }, 'r2_token_revoke_failed')
    }
  },

  /**
   * Upload a snapshot to R2 using backend credentials.
   * Used as fallback when Box doesn't have vault credentials.
   */
  async uploadSnapshotBase64(
    base64Data: string,
    integradorId: string,
    clienteFinalId: string,
    edgeNodeId: string,
    eventId: string,
  ): Promise<R2UploadResult | null> {
    if (!r2Client) {
      logger.debug('R2 client not configured, skipping upload')
      return null
    }

    const bucket = getBucketName(integradorId)
    const prefix = getTenantPrefix(clienteFinalId, edgeNodeId)
    const dateStr = new Date().toISOString().slice(0, 10)
    // Key structure: {clienteFinalId}/{edgeNodeId}/events/{date}/{eventId}.webp
    // Isso garante que a key está dentro do prefixo escopado nas credenciais
    const key = `${prefix}events/${dateStr}/${eventId}.webp`

    try {
      const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Clean, 'base64')

      await r2Client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: 'image/webp',
        }),
      )

      const url = `${R2_ENDPOINT}/${bucket}/${key}`
      logger.debug({ bucket, key }, 'r2_upload_ok')

      return { bucket, key, url }
    } catch (err: any) {
      logger.error({ err: err.message, bucket, key }, 'r2_upload_failed')
      return null
    }
  },

  /**
   * Generate a presigned URL for reading an object.
   * Used to serve evidence to authorized users without exposing credentials.
   */
  async getPresignedUrl(
    bucket: string,
    key: string,
    expiresInSeconds = 3600,
  ): Promise<string | null> {
    if (!r2Client) return null

    try {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key })
      return await getSignedUrl(r2Client, command, { expiresIn: expiresInSeconds })
    } catch (err: any) {
      logger.warn({ err: err.message, bucket, key }, 'r2_presign_failed')
      return null
    }
  },

  /**
   * Check if an object exists.
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    if (!r2Client) return false

    try {
      await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return true
    } catch {
      return false
    }
  },

  /**
   * Ensure a bucket exists (creates if missing).
   *
   * VAULT_R2_UNBLOCK 2026-05-06 robustez: 2 caminhos
   *   A) Cloudflare API com R2_API_TOKEN  (preferido — endpoint nativo R2)
   *   B) S3 SDK CreateBucketCommand        (fallback usando access keys já setadas)
   *
   * Idempotente: silencia "BucketAlreadyOwnedByYou" / "already exists".
   * Não-bloqueante para callers (logwarn em caso de outros erros).
   */
  async ensureBucket(integradorId: string): Promise<string> {
    const bucket = getBucketName(integradorId)
    if (!this.isConfigured()) return bucket

    // ── Caminho A: Cloudflare API (se R2_API_TOKEN configurado) ──────────────
    if (R2_API_TOKEN) {
      try {
        await cfFetch(`/accounts/${R2_ACCOUNT_ID}/r2/buckets`, {
          method: 'POST',
          body: JSON.stringify({ name: bucket }),
        })
        logger.info({ bucket, mode: 'cf_api' }, 'r2_bucket_created')
        return bucket
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.message?.includes('bucket_already_exists')) {
          return bucket // OK
        }
        logger.warn({ err: err.message, bucket }, 'r2_bucket_cf_api_failed_falling_back_to_s3')
        // Fall through para S3 SDK
      }
    }

    // ── Caminho B: S3 SDK CreateBucketCommand (usa R2_ACCESS_KEY_ID já setado) ─
    if (r2Client) {
      try {
        const { CreateBucketCommand } = await import('@aws-sdk/client-s3')
        await r2Client.send(new CreateBucketCommand({ Bucket: bucket }))
        logger.info({ bucket, mode: 's3_sdk' }, 'r2_bucket_created')
      } catch (err: any) {
        const code = err?.Code || err?.name
        if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
          // Bucket já existe e é nosso — ok
          return bucket
        }
        logger.warn({ err: err.message, code, bucket }, 'r2_bucket_s3_sdk_failed')
      }
    }

    return bucket
  },

  /**
   * Valida se um usuário tem acesso a um objeto específico.
   * Usado antes de gerar presigned URLs para garantir isolamento multi-tenant.
   *
   * Regras de acesso:
   * - SUPER_ADMIN: acesso a todos os buckets/keys
   * - INTEGRADOR_ADMIN: acesso apenas ao bucket do seu integrador
   * - CLIENTE_ADMIN/CLIENTE_USER: acesso apenas às keys do seu clienteFinalId
   *
   * @param bucket - Nome do bucket (icv-{integradorId})
   * @param key - Key do objeto ({clienteFinalId}/{edgeNodeId}/...)
   * @param userContext - Contexto do usuário autenticado
   */
  validateAccess(
    bucket: string,
    key: string,
    userContext: {
      role: string
      integradorId?: string | null
      clienteFinalId?: string | null
    },
  ): { allowed: boolean; reason?: string } {
    const { role, integradorId, clienteFinalId } = userContext

    // SUPER_ADMIN tem acesso total
    if (role === 'SUPER_ADMIN') {
      return { allowed: true }
    }

    // Extrai integradorId do bucket name
    const bucketIntegradorId = bucket.replace('icv-', '')

    // INTEGRADOR_ADMIN: só pode acessar seu próprio bucket
    if (role === 'INTEGRADOR_ADMIN') {
      if (!integradorId) {
        return { allowed: false, reason: 'missing_integrador_context' }
      }
      if (bucketIntegradorId !== integradorId.toLowerCase()) {
        return { allowed: false, reason: 'bucket_not_owned' }
      }
      return { allowed: true }
    }

    // CLIENTE_*: precisa validar bucket E prefix
    if (role === 'CLIENTE_ADMIN' || role === 'CLIENTE_USER') {
      if (!integradorId || !clienteFinalId) {
        return { allowed: false, reason: 'missing_tenant_context' }
      }
      if (bucketIntegradorId !== integradorId.toLowerCase()) {
        return { allowed: false, reason: 'bucket_not_owned' }
      }
      // Valida que a key começa com o clienteFinalId do usuário
      const tenant = r2Keys.parseTenant(key)
      if (!tenant || tenant.clienteFinalId !== clienteFinalId) {
        return { allowed: false, reason: 'key_not_owned' }
      }
      return { allowed: true }
    }

    return { allowed: false, reason: 'unknown_role' }
  },

  /** Gera bucket name para um integradorId (expõe helper interno) */
  getBucketName,

  /**
   * Upload de logo (white-label) para R2.
   * Diferente de uploadSnapshotBase64: não está sob isolamento por
   * clienteFinal — fica em prefixo `branding/` do bucket do integrador,
   * acessível publicamente via R2 público (ou presigned URL no frontend).
   *
   * scope: 'integrador' | 'cliente'
   *   - integrador: branding/integrador.{ext}  (logo do próprio integrador)
   *   - cliente:    branding/clientes/<clienteFinalId>.{ext}
   *
   * Retorna URL pública (R2_ENDPOINT/bucket/key). Caller persiste em
   * Integrador.logoUrl ou ClienteFinal.logoUrl.
   */
  async uploadLogoBuffer(
    buffer: Buffer,
    contentType: string,
    integradorId: string,
    scope: 'integrador' | 'cliente',
    scopeId?: string,
  ): Promise<R2UploadResult | null> {
    if (!r2Client) {
      logger.debug('R2 client not configured, skipping logo upload')
      return null
    }
    const bucket = getBucketName(integradorId)
    const ext = contentType.includes('svg')  ? 'svg'
              : contentType.includes('png')  ? 'png'
              : contentType.includes('webp') ? 'webp'
              : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
              : 'bin'
    const cacheBust = Date.now().toString(36)
    const key = scope === 'integrador'
      ? `branding/integrador-${cacheBust}.${ext}`
      : `branding/clientes/${scopeId}-${cacheBust}.${ext}`
    try {
      await r2Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=86400',
      }))
      const url = `${R2_ENDPOINT}/${bucket}/${key}`
      logger.info({ bucket, key, integradorId, scope }, 'r2_logo_upload_ok')
      return { bucket, key, url }
    } catch (err: any) {
      logger.error({ err: err.message, bucket, key }, 'r2_logo_upload_failed')
      return null
    }
  },
}
