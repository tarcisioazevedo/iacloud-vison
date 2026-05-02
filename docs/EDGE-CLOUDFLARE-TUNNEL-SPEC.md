# Especificação: Cloudflare Tunnel para Edge Box

**Versão:** 1.0.0  
**Data:** 2026-05-02  
**Status:** Para implementação na Box IDE

---

## Contexto do Problema

A Edge Box roda na rede local do cliente e precisa expor o **go2rtc** (porta 1984) para que o Cloud possa fazer proxy do stream de vídeo. Sem isso:

- Cloud não consegue acessar streams das câmeras
- Teste de RTSP falha (cloud tenta IP privado diretamente)
- Live streaming não funciona

**Solução:** Cloudflare Tunnel gerenciado automaticamente pela Box.

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REDE LOCAL DO CLIENTE                       │
│                                                                     │
│  ┌──────────────┐     RTSP      ┌─────────────────────────────────┐│
│  │   Câmera     │──────────────▶│          EDGE BOX               ││
│  │ 192.168.x.x  │               │                                 ││
│  └──────────────┘               │  ┌─────────┐    ┌────────────┐  ││
│                                 │  │ Frigate │───▶│  go2rtc    │  ││
│                                 │  │  :5000  │    │   :1984    │  ││
│                                 │  └─────────┘    └─────┬──────┘  ││
│                                 │                       │         ││
│                                 │  ┌────────────────────▼───────┐ ││
│                                 │  │      cloudflared           │ ││
│                                 │  │  (tunnel → Cloudflare)     │ ││
│                                 │  └────────────────────────────┘ ││
│                                 └─────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ Tunnel seguro (HTTPS)
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE EDGE NETWORK                         │
│                                                                     │
│   https://{tunnel-id}.cfargotunnel.com  ──▶  box:1984 (go2rtc)     │
│   https://{edge-name}.tunnels.iacloud.com.br (CNAME opcional)      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      CLOUD (app.iacloud.com.br)                     │
│                                                                     │
│   Backend consulta EdgeNode.go2rtcEndpoint                         │
│   Faz proxy WHEP/MJPEG através do tunnel                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Fluxo de Implementação

### FASE 1: Box solicita criação de tunnel (Box → Cloud)

**Quando:** No boot da Box, se `go2rtcEndpoint` não estiver configurado ou tunnel não estiver ativo.

**Endpoint Cloud:**
```
POST /iacv-box/tunnel/provision
Authorization: via licenseKey (mesmo auth do heartbeat)

Request:
{
  "licenseKey": "ICV-XXXX-XXXX-XXXX",
  "go2rtcPort": 1984,
  "frigatePort": 5000,        // opcional, para acesso ao Frigate UI
  "hostname": "edge-lab-001"  // nome amigável
}

Response (sucesso):
{
  "tunnelId": "uuid-do-tunnel",
  "tunnelToken": "eyJhIjoiNjM...",  // token para cloudflared
  "tunnelName": "icv-edge-en-lab-001",
  "publicHostname": "en-lab-001.tunnels.iacloud.com.br",
  "go2rtcUrl": "https://en-lab-001.tunnels.iacloud.com.br",
  "config": {
    "ingress": [
      { "hostname": "en-lab-001.tunnels.iacloud.com.br", "service": "http://localhost:1984" },
      { "service": "http_status:404" }
    ]
  }
}

Response (tunnel já existe):
{
  "tunnelId": "uuid-existente",
  "tunnelToken": "eyJhIjoiNjM...",
  "tunnelName": "icv-edge-en-lab-001",
  "publicHostname": "en-lab-001.tunnels.iacloud.com.br",
  "go2rtcUrl": "https://en-lab-001.tunnels.iacloud.com.br",
  "status": "existing"
}
```

### FASE 2: Box instala e executa cloudflared

**Na Box (Python/Shell):**

```python
import subprocess
import os

def setup_cloudflared(tunnel_token: str):
    """
    Instala cloudflared e configura como serviço.
    """
    # 1. Verifica se cloudflared está instalado
    result = subprocess.run(['which', 'cloudflared'], capture_output=True)
    if result.returncode != 0:
        # Instala cloudflared
        subprocess.run([
            'curl', '-L', '--output', '/tmp/cloudflared.deb',
            'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb'
        ], check=True)
        subprocess.run(['sudo', 'dpkg', '-i', '/tmp/cloudflared.deb'], check=True)
    
    # 2. Para serviço existente (se houver)
    subprocess.run(['sudo', 'systemctl', 'stop', 'cloudflared'], capture_output=True)
    
    # 3. Instala serviço com o token
    subprocess.run([
        'sudo', 'cloudflared', 'service', 'install', tunnel_token
    ], check=True)
    
    # 4. Inicia e habilita
    subprocess.run(['sudo', 'systemctl', 'enable', 'cloudflared'], check=True)
    subprocess.run(['sudo', 'systemctl', 'start', 'cloudflared'], check=True)
    
    # 5. Verifica status
    result = subprocess.run(
        ['sudo', 'systemctl', 'is-active', 'cloudflared'],
        capture_output=True, text=True
    )
    return result.stdout.strip() == 'active'
```

**Alternativa Docker (se Box roda em container):**

```yaml
# docker-compose.yml na Box
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${TUNNEL_TOKEN}
    environment:
      - TUNNEL_TOKEN=${TUNNEL_TOKEN}
    network_mode: host  # acessa localhost:1984
```

### FASE 3: Box reporta status do tunnel (Box → Cloud)

**Incluir no heartbeat existente:**

```python
# Adicionar ao payload do heartbeat
heartbeat_payload = {
    "licenseKey": license_key,
    "cpuUsage": cpu,
    "memUsage": mem,
    # ... campos existentes ...
    
    # NOVO: status do tunnel
    "tunnel": {
        "active": True,
        "tunnelId": "uuid-do-tunnel",
        "publicUrl": "https://en-lab-001.tunnels.iacloud.com.br",
        "cloudflaredVersion": "2024.5.0",
        "connectedAt": "2026-05-02T10:00:00Z",
        "lastError": None
    }
}
```

**Cloud atualiza EdgeNode automaticamente:**

```typescript
// No handler do heartbeat (iacv-box.ts)
if (body.tunnel?.active && body.tunnel?.publicUrl) {
  await prisma.edgeNode.update({
    where: { id: nodeId },
    data: {
      go2rtcEndpoint: body.tunnel.publicUrl,
      // webrtcPublicHost pode ser derivado
      webrtcPublicHost: new URL(body.tunnel.publicUrl).hostname,
    },
  })
}
```

---

## API Cloudflare (para o Cloud implementar)

### Credenciais necessárias

```env
# .env do Cloud
CLOUDFLARE_ACCOUNT_ID=abc123...
CLOUDFLARE_API_TOKEN=xxxxx   # Permissões: Account > Cloudflare Tunnel > Edit
CLOUDFLARE_ZONE_ID=xyz789... # Para criar DNS records (opcional)
```

### Criar Tunnel

```typescript
// cloud: src/services/cloudflare-tunnel.service.ts

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4'

interface CreateTunnelResponse {
  result: {
    id: string
    name: string
    token: string
    credentials_file: object
  }
  success: boolean
}

async function createTunnel(edgeNodeId: string, name: string): Promise<CreateTunnelResponse> {
  const response = await fetch(
    `${CLOUDFLARE_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `icv-edge-${edgeNodeId}`,
        config_src: 'cloudflare',
      }),
    }
  )
  return response.json()
}

async function configureTunnel(tunnelId: string, hostname: string, localPort: number) {
  const response = await fetch(
    `${CLOUDFLARE_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/configurations`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, service: `http://localhost:${localPort}` },
            { service: 'http_status:404' },
          ],
        },
      }),
    }
  )
  return response.json()
}

async function getTunnelToken(tunnelId: string): Promise<string> {
  const response = await fetch(
    `${CLOUDFLARE_API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel/${tunnelId}/token`,
    {
      headers: { 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
    }
  )
  const data = await response.json()
  return data.result
}
```

### Criar DNS Record (opcional, para hostname amigável)

```typescript
async function createDnsRecord(tunnelId: string, subdomain: string) {
  // Cria CNAME: subdomain.tunnels.iacloud.com.br → tunnelId.cfargotunnel.com
  const response = await fetch(
    `${CLOUDFLARE_API}/zones/${CLOUDFLARE_ZONE_ID}/dns_records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'CNAME',
        name: `${subdomain}.tunnels`,
        content: `${tunnelId}.cfargotunnel.com`,
        proxied: true,
      }),
    }
  )
  return response.json()
}
```

---

## Checklist de Implementação

### Cloud IDE (este repositório)

- [ ] Criar `src/services/cloudflare-tunnel.service.ts`
- [ ] Adicionar endpoint `POST /iacv-box/tunnel/provision`
- [ ] Adicionar campos ao schema do heartbeat (tunnel status)
- [ ] Atualizar handler do heartbeat para salvar go2rtcEndpoint
- [ ] Adicionar variáveis de ambiente Cloudflare
- [ ] Criar migration se necessário (campos já existem no EdgeNode)

### Box IDE (outro repositório)

- [ ] Implementar `tunnel_manager.py` ou equivalente
- [ ] No boot: verificar se tunnel está configurado
- [ ] Se não: chamar `POST /iacv-box/tunnel/provision`
- [ ] Instalar/iniciar cloudflared com o token recebido
- [ ] Incluir status do tunnel no heartbeat
- [ ] Monitorar saúde do cloudflared (restart se necessário)
- [ ] Logs de conexão/desconexão do tunnel

---

## Exemplo de Fluxo Completo

```
1. Box liga
   │
   ▼
2. Box verifica: tunnel ativo?
   │ NÃO
   ▼
3. Box chama POST /iacv-box/tunnel/provision
   │
   ▼
4. Cloud cria tunnel via API Cloudflare
   │ - POST /accounts/{id}/cfd_tunnel
   │ - PUT  /accounts/{id}/cfd_tunnel/{id}/configurations
   │ - POST /zones/{id}/dns_records (CNAME)
   │
   ▼
5. Cloud retorna tunnelToken + publicUrl
   │
   ▼
6. Box executa: cloudflared service install <token>
   │
   ▼
7. Box inclui no heartbeat: tunnel.active=true, tunnel.publicUrl=...
   │
   ▼
8. Cloud atualiza EdgeNode.go2rtcEndpoint = publicUrl
   │
   ▼
9. Frontend/API podem fazer proxy de stream via tunnel
   │
   ▼
10. Câmeras associadas ao Edge Node funcionam! ✓
```

---

## Considerações de Segurança

1. **Tunnel Token:** Armazenar de forma segura na Box (não em plaintext)
2. **Acesso ao go2rtc:** Considerar auth básica no go2rtc (go2rtcAuth)
3. **Rate limiting:** Cloudflare já fornece DDoS protection
4. **Rotação:** Permitir regenerar tunnel se comprometido

---

## Referências

- [Cloudflare Tunnel Docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Cloudflare API - Tunnels](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/)
- [go2rtc Documentation](https://github.com/AlexxIT/go2rtc)
