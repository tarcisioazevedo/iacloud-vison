/**
 * Cloudflare Worker — Tenant Router
 *
 * Responsabilidade: inspecionar o Host header de cada request e injetar
 * o header X-ICV-Tenant (<integradorId>.<ts>.<hmac>) que o backend usa
 * para identificar o tenant sem expor o integradorId na URL.
 *
 * Fluxo:
 *   1. Request chega em monitor.meuisp.com.br (ou meuisp.iacloud.com.br)
 *   2. Worker consulta KV (ICV_TENANTS) — hostname → integradorId
 *   3. Worker assina X-ICV-Tenant com HMAC-SHA256 (chave ICV_TENANT_SECRET)
 *   4. Request é passada ao origin app.iacloud.com.br com o header injetado
 *
 * KV namespace ICV_TENANTS — entradas JSON:
 *   key: hostname  →  value: { "integradorId": "uuid", "active": true }
 *   Ex.: "meuisp.iacloud.com.br" → { "integradorId": "abc-123", "active": true }
 *
 * Variáveis de ambiente (Worker):
 *   ICV_TENANT_SECRET   — string 32+ chars, deve ser igual a TENANT_HMAC_SECRET no backend
 *   ICV_ORIGIN          — https://app.iacloud.com.br (origin backend)
 *   ICV_TENANTS         — KV Namespace binding
 *
 * Como provisionar uma entrada no KV (CLI):
 *   wrangler kv:key put --namespace-id=<NS_ID> \
 *     "meuisp.iacloud.com.br" \
 *     '{"integradorId":"abc-123","active":true}'
 *
 * O backend já chama cloudflare.service.ts para criar o DNS record.
 * Após criação do DNS, o SUPER_ADMIN deve adicionar a entrada KV via
 *   POST /admin/whitelabel/:integradorId/kv-provision  (a implementar)
 * ou manualmente via wrangler.
 *
 * Segurança:
 *   - HMAC replay protection: backend rejeita tokens com ts > 60s atrás
 *   - KV miss → request passa sem header (backend serve como anônimo ou 401)
 *   - Sem logging de IDs sensíveis nos Workers logs
 */

export default {
  async fetch(request, env) {
    const url     = new URL(request.url)
    const hostname = url.hostname   // "meuisp.iacloud.com.br" ou "monitor.meuisp.com.br"

    // Consulta KV pelo hostname
    let tenantEntry = null
    try {
      const raw = await env.ICV_TENANTS.get(hostname)
      if (raw) tenantEntry = JSON.parse(raw)
    } catch {
      // KV indisponível — passa sem header (degraded, não bloqueante)
    }

    // Monta request para o origin
    const originUrl = new URL(request.url)
    originUrl.hostname = new URL(env.ICV_ORIGIN).hostname

    const headers = new Headers(request.headers)
    headers.set('X-Forwarded-Host', hostname)

    // Injeta X-ICV-Tenant apenas se tenant encontrado e ativo
    if (tenantEntry?.active && tenantEntry?.integradorId) {
      const ts   = Math.floor(Date.now() / 1000).toString()
      const msg  = `${tenantEntry.integradorId}.${ts}`
      const hmac = await computeHmac(msg, env.ICV_TENANT_SECRET)
      headers.set('X-ICV-Tenant', `${tenantEntry.integradorId}.${ts}.${hmac}`)
    }

    const originReq = new Request(originUrl.toString(), {
      method:  request.method,
      headers,
      body:    request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      redirect: 'manual',
    })

    const response = await fetch(originReq)

    // Passa a resposta de volta, preservando headers do origin
    const respHeaders = new Headers(response.headers)
    // Substitui Location se for redirect absoluto para o origin interno
    const location = respHeaders.get('location')
    if (location?.includes(new URL(env.ICV_ORIGIN).hostname)) {
      respHeaders.set('location', location.replace(new URL(env.ICV_ORIGIN).hostname, hostname))
    }

    return new Response(response.body, {
      status:  response.status,
      headers: respHeaders,
    })
  },
}

// ── HMAC-SHA256 via SubtleCrypto (disponível em Workers) ────────────────────

async function computeHmac(message, secret) {
  const enc     = new TextEncoder()
  const keyData = enc.encode(secret)
  const msgData = enc.encode(message)

  const key = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, msgData)
  return bufToHex(sig)
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
