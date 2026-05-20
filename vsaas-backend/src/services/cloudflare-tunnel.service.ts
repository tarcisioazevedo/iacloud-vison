/**
 * Cloudflare Tunnel Service
 *
 * Gerencia criação e configuração de tunnels para Edge Boxes.
 * Cada Edge Node recebe um tunnel dedicado que expõe go2rtc para o cloud.
 *
 * Credenciais:
 *   1. Prioridade — env `*_FILE` (Docker Swarm secret mount em /run/secrets/...)
 *   2. Fallback — env direta (DEV/lab)
 */
import fs from 'fs'
import { logger } from '../lib/logger'

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

/** Lê valor do env, ou do arquivo apontado por <NAME>_FILE se existir. */
function readSecret(envName: string): string | undefined {
  const fileEnv = process.env[`${envName}_FILE`]
  if (fileEnv && fs.existsSync(fileEnv)) {
    try {
      return fs.readFileSync(fileEnv, 'utf-8').trim()
    } catch (err: any) {
      logger.warn({ envName, file: fileEnv, err: err.message }, 'cloudflare_secret_file_read_failed')
    }
  }
  return process.env[envName]
}

const ACCOUNT_ID = readSecret('CLOUDFLARE_ACCOUNT_ID')
const API_TOKEN = readSecret('CLOUDFLARE_API_TOKEN')
const ZONE_ID = readSecret('CLOUDFLARE_ZONE_ID') // opcional, para DNS

interface CloudflareResponse<T> {
  success: boolean
  result: T
  errors: { code: number; message: string }[]
  messages: string[]
}

interface TunnelResult {
  id: string
  name: string
  created_at: string
  deleted_at: string | null
  status: 'inactive' | 'degraded' | 'healthy' | 'down'
  connections: {
    id: string
    features: string[]
    version: string
    arch: string
    run_at: string
    origin_ip: string
  }[]
  token?: string
}

interface TunnelConfig {
  config: {
    ingress: {
      hostname?: string
      service: string
      path?: string
    }[]
  }
}

export const cloudflareTunnelService = {
  isConfigured(): boolean {
    return !!(ACCOUNT_ID && API_TOKEN)
  },

  async createTunnel(edgeNodeId: string, name: string): Promise<{
    tunnelId: string
    tunnelName: string
    token: string
  }> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare credentials not configured')
    }

    const tunnelName = `icv-edge-${edgeNodeId}`

    const response = await fetch(
      `${CLOUDFLARE_API}/accounts/${ACCOUNT_ID}/cfd_tunnel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: tunnelName,
          config_src: 'cloudflare',
        }),
      }
    )

    const data = await response.json() as CloudflareResponse<TunnelResult>

    if (!data.success) {
      const errorMsg = data.errors?.[0]?.message ?? 'Unknown Cloudflare error'
      logger.error({ errors: data.errors, edgeNodeId }, 'cloudflare_tunnel_create_failed')
      throw new Error(`Cloudflare API error: ${errorMsg}`)
    }

    logger.info({ tunnelId: data.result.id, tunnelName, edgeNodeId }, 'cloudflare_tunnel_created')

    return {
      tunnelId: data.result.id,
      tunnelName: data.result.name,
      token: data.result.token ?? '',
    }
  },

  async getTunnelToken(tunnelId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare credentials not configured')
    }

    const response = await fetch(
      `${CLOUDFLARE_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
      {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` },
      }
    )

    const data = await response.json() as CloudflareResponse<string>

    if (!data.success) {
      throw new Error(`Failed to get tunnel token: ${data.errors?.[0]?.message}`)
    }

    return data.result
  },

  async configureTunnel(
    tunnelId: string,
    hostname: string,
    localPort: number = 1984
  ): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare credentials not configured')
    }

    const config: TunnelConfig = {
      config: {
        ingress: [
          { hostname, service: `http://localhost:${localPort}` },
          { service: 'http_status:404' },
        ],
      },
    }

    const response = await fetch(
      `${CLOUDFLARE_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      }
    )

    const data = await response.json() as CloudflareResponse<unknown>

    if (!data.success) {
      logger.error({ errors: data.errors, tunnelId }, 'cloudflare_tunnel_config_failed')
      throw new Error(`Failed to configure tunnel: ${data.errors?.[0]?.message}`)
    }

    logger.info({ tunnelId, hostname, localPort }, 'cloudflare_tunnel_configured')
  },

  async createDnsRecord(tunnelId: string, subdomain: string): Promise<string> {
    if (!ZONE_ID) {
      logger.warn('CLOUDFLARE_ZONE_ID not configured, skipping DNS record creation')
      return `${tunnelId}.cfargotunnel.com`
    }

    // Usa naming de 1º nível (`tn-<edge>.iacloud.com.br`) — Cloudflare Universal SSL
    // grátis cobre apenas `*.iacloud.com.br`. Subdomínios de 2º nível
    // (`*.tunnels.iacloud.com.br`) exigem Advanced Certificate (pago) e geram
    // TLS handshake failure 552 sem ele. Prefixo `tn-` mantém namespace dedicado.
    const recordName = `tn-${subdomain}`
    const hostname = `${recordName}.iacloud.com.br`

    const response = await fetch(
      `${CLOUDFLARE_API}/zones/${ZONE_ID}/dns_records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'CNAME',
          name: recordName,
          content: `${tunnelId}.cfargotunnel.com`,
          proxied: true,
        }),
      }
    )

    const data = await response.json() as CloudflareResponse<{ id: string; name: string }>

    if (!data.success) {
      // DNS record might already exist - not a fatal error
      logger.warn({ errors: data.errors, subdomain }, 'cloudflare_dns_create_failed')
      return `${tunnelId}.cfargotunnel.com`
    }

    logger.info({ hostname, tunnelId }, 'cloudflare_dns_created')
    return hostname
  },

  async listTunnels(): Promise<TunnelResult[]> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare credentials not configured')
    }

    const response = await fetch(
      `${CLOUDFLARE_API}/accounts/${ACCOUNT_ID}/cfd_tunnel?is_deleted=false`,
      {
        headers: { 'Authorization': `Bearer ${API_TOKEN}` },
      }
    )

    const data = await response.json() as CloudflareResponse<TunnelResult[]>

    if (!data.success) {
      throw new Error(`Failed to list tunnels: ${data.errors?.[0]?.message}`)
    }

    return data.result
  },

  async findTunnelByName(name: string): Promise<TunnelResult | null> {
    const tunnels = await this.listTunnels()
    return tunnels.find(t => t.name === name) ?? null
  },

  async deleteTunnel(tunnelId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Cloudflare credentials not configured')
    }

    const response = await fetch(
      `${CLOUDFLARE_API}/accounts/${ACCOUNT_ID}/cfd_tunnel/${tunnelId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${API_TOKEN}` },
      }
    )

    const data = await response.json() as CloudflareResponse<unknown>

    if (!data.success) {
      throw new Error(`Failed to delete tunnel: ${data.errors?.[0]?.message}`)
    }

    logger.info({ tunnelId }, 'cloudflare_tunnel_deleted')
  },

  /**
   * Provisiona um tunnel completo para um Edge Node.
   * 1. Cria tunnel (ou reutiliza existente)
   * 2. Configura ingress
   * 3. Cria DNS record (se ZONE_ID configurado)
   * 4. Retorna token para cloudflared
   */
  async provisionForEdgeNode(
    edgeNodeId: string,
    edgeNodeName: string,
    go2rtcPort: number = 1984
  ): Promise<{
    tunnelId: string
    tunnelToken: string
    tunnelName: string
    publicHostname: string
    go2rtcUrl: string
    isNew: boolean
  }> {
    const tunnelName = `icv-edge-${edgeNodeId}`
    const subdomain = edgeNodeName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')

    // Check if tunnel already exists
    let tunnel = await this.findTunnelByName(tunnelName)
    let isNew = false

    if (!tunnel) {
      // Create new tunnel
      const created = await this.createTunnel(edgeNodeId, tunnelName)
      tunnel = {
        id: created.tunnelId,
        name: created.tunnelName,
        token: created.token,
        created_at: new Date().toISOString(),
        deleted_at: null,
        status: 'inactive',
        connections: [],
      }
      isNew = true
    }

    // Get token (might not be in create response)
    const tunnelToken = tunnel.token || await this.getTunnelToken(tunnel.id)

    // Create DNS record (returns fallback if ZONE_ID not set)
    const publicHostname = await this.createDnsRecord(tunnel.id, subdomain)

    // Configure ingress
    await this.configureTunnel(tunnel.id, publicHostname, go2rtcPort)

    return {
      tunnelId: tunnel.id,
      tunnelToken,
      tunnelName: tunnel.name,
      publicHostname,
      go2rtcUrl: `https://${publicHostname}`,
      isNew,
    }
  },
}
