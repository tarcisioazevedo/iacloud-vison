/**
 * Cloudflare Service — provisão de subdomínios de tenant.
 *
 * Cada integrador (B2B2B middle) ganha um subdomínio isolado
 * `<slug>.iacloud.com.br` que serve como entry point para o frontend
 * e a API do tenant. O subdomínio é um CNAME que aponta para um origin
 * compartilhado (`ICV_CF_TENANT_ORIGIN`); o roteamento por tenant é
 * feito no Worker (próxima etapa) usando o Host header pra identificar
 * de qual integrador a request veio.
 *
 * Estratégia de DNS:
 *   <slug>.iacloud.com.br  CNAME  app.iacloud.com.br   (proxied=true)
 *
 * Vantagem do CNAME (vs A record por tenant): se mudarmos o IP do
 * backend, basta atualizar UM registro (`app.iacloud.com.br`) em vez
 * de N registros — operacionalmente seguro pra dev e prod.
 *
 * Token: Account-owned, scope Zone:DNS Edit + Zone:Read em iacloud.com.br
 * (ICV_CF_DNS_TOKEN). Detalhes em .env.example.
 *
 * Limites do plano Free relevantes:
 *   - DNS records:       1000 por zona            (folga absurda)
 *   - API rate:          1200 req/5min por token  (mais que suficiente)
 *   - Wildcard TLS:      incluso (universal SSL)
 *
 * Endpoints da CF API utilizados:
 *   - GET  /zones/:zone/dns_records
 *   - POST /zones/:zone/dns_records
 *   - DELETE /zones/:zone/dns_records/:id
 *   - PATCH /zones/:zone/dns_records/:id
 * Docs: https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-list-dns-records
 */
import { logger } from '../lib/logger'
import { ValidationError } from '../lib/errors'

const CF_BASE = 'https://api.cloudflare.com/client/v4'

// ─── Config — lidas no boot pra falhar cedo se faltar env ──────────────────
function readConfig() {
  const token   = process.env.ICV_CF_DNS_TOKEN
  const zoneId  = process.env.ICV_CF_ZONE_ID
  const root    = process.env.ICV_CF_ROOT_DOMAIN ?? 'vsaas.com.br'
  const origin  = process.env.ICV_CF_TENANT_ORIGIN ?? `app.${root}`

  if (!token || token.length < 20) {
    throw new Error('ICV_CF_DNS_TOKEN ausente ou inválido (.env)')
  }
  if (!zoneId || zoneId.length < 16) {
    throw new Error('ICV_CF_ZONE_ID ausente ou inválido (.env)')
  }
  return { token, zoneId, root, origin }
}

// ─── Slugify — gera subdomínio DNS-safe a partir do nome do integrador ─────
//
// Regras DNS RFC 1035 / 952 / 1123:
//   - só [a-z0-9-]
//   - começa e termina com [a-z0-9]
//   - até 63 chars por label
//   - "xn--" reservado (punycode IDN); evitamos prefixar com isso
//
// Estratégia: lowercase + remove acentos + troca não-alfanum por hífen +
// colapsa hífens duplos + apara das pontas + limita 40 chars (deixa folga
// pra evitar colisão com o root e pra ler bem na URL).
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')                       // separa acentos
    .replace(/[\u0300-\u036f]/g, '')        // remove diacríticos
    .replace(/[^a-z0-9]+/g, '-')            // não-alfanum → hífen
    .replace(/-+/g, '-')                    // colapsa --
    .replace(/^-+|-+$/g, '')                // apara das pontas
    .slice(0, 40)
    .replace(/-+$/g, '')                    // se cortou no meio de hífen, apara

  if (base.length < 2) {
    throw new ValidationError('Nome do integrador muito curto para gerar subdomínio')
  }
  if (base.startsWith('xn--')) {
    throw new ValidationError('Slug não pode começar com "xn--" (reservado IDN)')
  }
  // Reservados que NÃO podem virar tenant — colidem com infra.
  const reserved = new Set([
    'app', 'api', 'www', 'admin', 'auth', 'ingest', 'edge',
    'mail', 'ftp', 'ns1', 'ns2', 'cdn', 'static', 'assets',
    'docs', 'status', 'billing', 'public', 'internal',
  ])
  if (reserved.has(base)) {
    throw new ValidationError(`Subdomínio "${base}" é reservado pela plataforma`)
  }
  return base
}

// ─── HTTP helper — autenticado e com tratamento de erro padronizado ────────
async function cfRequest<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: object,
): Promise<T> {
  const { token } = readConfig()
  const url = `${CF_BASE}${path}`

  const resp = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const json: any = await resp.json().catch(() => ({}))

  if (!resp.ok || json?.success === false) {
    const code = json?.errors?.[0]?.code ?? resp.status
    const msg  = json?.errors?.[0]?.message ?? resp.statusText
    logger.error({ method, path, status: resp.status, code, msg }, 'cloudflare_api_error')
    throw new Error(`Cloudflare API ${code}: ${msg}`)
  }
  return json as T
}

// ─── DNS Records ───────────────────────────────────────────────────────────

export interface CfDnsRecord {
  id:       string
  type:     'A' | 'CNAME' | 'TXT' | 'AAAA'
  name:     string
  content:  string
  proxied:  boolean
  ttl:      number
}

interface CfListResponse {
  result: CfDnsRecord[]
  result_info: { count: number; total_count: number }
}
interface CfRecordResponse {
  result: CfDnsRecord
}

export class CloudflareService {
  /**
   * Provisiona subdomínio CNAME pro tenant.
   *
   * - Idempotente: se já existe `<slug>.<root>` aponta pro mesmo origin,
   *   retorna o registro existente em vez de duplicar (CF aceita duplicatas
   *   só pra A/AAAA, mas pra CNAME na mesma name é proibido — então o
   *   POST falharia com erro 81057. Pre-checkando evita o erro feio).
   * - Proxied=true ativa o reverse proxy (CDN, DDoS, TLS gratuito).
   * - TTL=1 = "Auto" (CF gerencia TTL ótimo quando proxied).
   *
   * Retorna { fqdn, recordId, created }.
   *   created=true  → criou agora
   *   created=false → já existia (idempotência)
   */
  async provisionTenantSubdomain(integradorName: string): Promise<{
    fqdn:     string
    slug:     string
    recordId: string
    created:  boolean
  }> {
    const { zoneId, root, origin } = readConfig()
    const slug = slugify(integradorName)
    const fqdn = `${slug}.${root}`

    // Pre-check: já existe?
    const existing = await this.findRecordByName(fqdn)
    if (existing) {
      // Se já aponta pro origin certo, idempotente.
      if (existing.type === 'CNAME' && existing.content === origin) {
        logger.info({ fqdn, recordId: existing.id }, 'cloudflare_subdomain_idempotent')
        return { fqdn, slug, recordId: existing.id, created: false }
      }
      // Aponta pra outro lugar — perigoso sobrescrever silenciosamente.
      throw new ValidationError(
        `Subdomínio ${fqdn} já existe apontando para ${existing.content} (esperado: ${origin})`,
      )
    }

    // Cria.
    const json = await cfRequest<CfRecordResponse>(
      'POST',
      `/zones/${zoneId}/dns_records`,
      {
        type:    'CNAME',
        name:    fqdn,
        content: origin,
        proxied: true,
        ttl:     1,
        comment: 'auto: ICV tenant provision',
      },
    )

    logger.info({ fqdn, recordId: json.result.id }, 'cloudflare_subdomain_created')
    return { fqdn, slug, recordId: json.result.id, created: true }
  }

  /** Remove subdomínio (usado em delete de integrador / rollback). */
  async deleteTenantSubdomain(slug: string): Promise<{ deleted: boolean }> {
    const { zoneId, root } = readConfig()
    const fqdn = `${slug}.${root}`
    const existing = await this.findRecordByName(fqdn)
    if (!existing) {
      logger.info({ fqdn }, 'cloudflare_subdomain_already_absent')
      return { deleted: false }
    }
    await cfRequest('DELETE', `/zones/${zoneId}/dns_records/${existing.id}`)
    logger.info({ fqdn, recordId: existing.id }, 'cloudflare_subdomain_deleted')
    return { deleted: true }
  }

  /** Busca registro DNS por nome exato; null se não existe. */
  async findRecordByName(fqdn: string): Promise<CfDnsRecord | null> {
    const { zoneId } = readConfig()
    // CF aceita filtro por name (match exato).
    const json = await cfRequest<CfListResponse>(
      'GET',
      `/zones/${zoneId}/dns_records?name=${encodeURIComponent(fqdn)}`,
    )
    return json.result[0] ?? null
  }

  /** Lista todos os subdomínios de tenant (debug / admin). */
  async listTenantSubdomains(): Promise<CfDnsRecord[]> {
    const { zoneId, root } = readConfig()
    // CF não tem filtro por sufixo nativo — buscamos tudo e filtramos.
    // Em volume alto (>1000) precisaria paginação; por ora 1 página basta.
    const json = await cfRequest<CfListResponse>(
      'GET',
      `/zones/${zoneId}/dns_records?type=CNAME&per_page=1000`,
    )
    return json.result.filter(r => r.name.endsWith(`.${root}`) && r.name !== `app.${root}`)
  }

  /**
   * Smoke test — útil em /health/ready ou em CLI de debug.
   * Bate em /zones/:id e confirma que o token tem acesso à zona certa.
   */
  async healthCheck(): Promise<{ ok: boolean; zoneName?: string; error?: string }> {
    try {
      const { zoneId } = readConfig()
      const json = await cfRequest<{ result: { name: string; status: string } }>(
        'GET',
        `/zones/${zoneId}`,
      )
      return { ok: json.result.status === 'active', zoneName: json.result.name }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  }
}

export const cloudflareService = new CloudflareService()

// ─── Workers KV — provisionamento de tenant no router Worker ──────────────
//
// O Worker tenant-router.js lê de um KV namespace (ICV_TENANTS) para mapear
// hostname → integradorId. Esta função escreve/remove entradas nesse KV.
//
// Variáveis necessárias:
//   ICV_CF_KV_ACCOUNT_ID   — Cloudflare Account ID (pode ser mesmo que zoneId owner)
//   ICV_CF_KV_NAMESPACE_ID — ID do KV namespace (wrangler kv:namespace list)
//   ICV_CF_DNS_TOKEN       — precisa de permissão Workers KV Storage:Edit

async function cfKvWrite(key: string, value: object): Promise<void> {
  const token       = process.env.ICV_CF_DNS_TOKEN
  const accountId   = process.env.ICV_CF_KV_ACCOUNT_ID
  const namespaceId = process.env.ICV_CF_KV_NAMESPACE_ID

  if (!token || !accountId || !namespaceId) {
    logger.warn({ key }, 'cf_kv_write_skipped_no_config')
    return
  }

  const url = `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`
  const resp = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`CF KV write failed ${resp.status}: ${text}`)
  }
}

async function cfKvDelete(key: string): Promise<void> {
  const token       = process.env.ICV_CF_DNS_TOKEN
  const accountId   = process.env.ICV_CF_KV_ACCOUNT_ID
  const namespaceId = process.env.ICV_CF_KV_NAMESPACE_ID

  if (!token || !accountId || !namespaceId) return

  const url = `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`
  await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  })
}

/**
 * Registra um hostname no KV do Worker tenant-router.
 * Chamado após domínio verificado (status ACTIVE em CustomDomain).
 */
export async function kvProvisionTenant(hostname: string, integradorId: string): Promise<void> {
  await cfKvWrite(hostname, { integradorId, active: true })
  logger.info({ hostname, integradorId }, 'cf_kv_tenant_provisioned')
}

/**
 * Remove um hostname do KV (domínio removido ou integrador suspenso).
 */
export async function kvDeprovisionTenant(hostname: string): Promise<void> {
  await cfKvDelete(hostname)
  logger.info({ hostname }, 'cf_kv_tenant_deprovisioned')
}
