# Plano de Escalabilidade — VSaaS

**Versão:** 1.0  
**Data:** 2026-05-12  
**Contexto:** baseado em testes empíricos CG10/CG12/γ-Day4 (vide `CAPACITY-MODEL.md`)  
**Arquitetura atual:** Docker Swarm single-node, Hetzner CPX42, 8 vCPU / 16 GB  

---

## TL;DR — O que bloqueia escala hoje

Existem **3 problemas estruturais** que impedem escalar sem refatoração:

| # | Problema | Efeito | Fase que resolve |
|---|---|---|---|
| 1 | Backend usa `mode: host` na porta 3000 | Impossível ter >1 réplica Node.js no mesmo nó | Fase 1 |
| 2 | Estado de gravação em `Map` / `Set` em memória | >1 réplica → Map vazio em cada processo → 2× ffmpeg bug reencarna | Fase 1 |
| 3 | go2rtc processo único | Satura ~200 streams; não tem HA | Fase 2 |

Tudo mais (Postgres, Redis, tmpfs, ffmpeg) aguenta bem até Fase 2.

---

## Fases de escala

```
Fase 0  ─── Hoje ──────── 0-80 cams     single-node, 1 réplica backend
Fase 1  ─── ~3 semanas ── 80-300 cams   Redis state + multi-réplica backend
Fase 2  ─── ~2 meses ──── 300-800 cams  2º nó worker + go2rtc dedicado
Fase 3  ─── ~6 meses ──── 800-3000 cams multi-região + go2rtc por PoP
```

---

## Fase 0 — Estado atual (✅ pronto)

```
VPS CPX42 (8 vCPU / 16 GB)
  backend (1 réplica, mode: host:3000)
  go2rtc (1 instância, todas as portas host)
  postgres (1 instância)
  redis (já existe no stack)
  pgbouncer (já existe no stack)
  tmpfs /recordings (4 GB)
```

**Capacidade real medida:** ~80 câmeras simultâneas com margem confortável.  
**Limitante:** event loop Node (resolvido com `POLL_MS=4000`, commit `83607a62`).

---

## Fase 1 — Multi-réplica backend (80–300 câmeras)

### Pré-requisitos técnicos

#### PR-1: Redis já existe no stack ✅
O `docker-stack.yml` já tem serviço Redis. Não precisa provisionar.  
Precisa apenas instalar cliente Redis no backend:

```bash
cd vsaas-backend
npm install ioredis
npm install --save-dev @types/ioredis  # se não vier junto
```

#### PR-2: Trocar `active Map` e `restartPending Set` por Redis HSET

**Arquivo:** `vsaas-backend/src/services/cloud-direct-recorder.service.ts`

Hoje (em memória, não compartilhado entre processos):
```typescript
const active         = new Map<string, RecorderState>()
const restartPending = new Set<string>()
```

Depois (Redis, compartilhado entre todas as réplicas):
```typescript
// redis-state.ts (novo arquivo)
import Redis from 'ioredis'
const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379')

export const recorderState = {
  async isActive(cameraId: string):         Promise<boolean> {
    return (await redis.hexists('recorder:active', cameraId)) === 1
  },
  async setActive(cameraId: string, state: RecorderState): Promise<void> {
    await redis.hset('recorder:active', cameraId, JSON.stringify(state))
  },
  async clearActive(cameraId: string):      Promise<void> {
    await redis.hdel('recorder:active', cameraId)
  },
  async listActive():                       Promise<Map<string, RecorderState>> {
    const raw = await redis.hgetall('recorder:active')
    return new Map(Object.entries(raw).map(([k, v]) => [k, JSON.parse(v)]))
  },
  async isPending(cameraId: string):        Promise<boolean> {
    return (await redis.hexists('recorder:pending', cameraId)) === 1
  },
  async setPending(cameraId: string):       Promise<void> {
    await redis.hset('recorder:pending', cameraId, '1')
    await redis.pexpire('recorder:pending', /* key */ cameraId, 5000)
    // auto-expira em 5s — safety net se réplica morrer durante restart window
  },
  async clearPending(cameraId: string):     Promise<void> {
    await redis.hdel('recorder:pending', cameraId)
  },
}
```

**Impacto:** ~200 linhas de refactor no `cloud-direct-recorder.service.ts`.  
**Estimativa de esforço:** 2-3 dias (código + testes manuais).

> ⚠️ **Atenção ao TTL no setPending:** o `restartPending` hoje expira implicitamente
> em 3s via `setTimeout`. No Redis, usar `PEXPIRE` ou `SET EX` como safety net pra
> não deixar câmera travada se a réplica reiniciar durante a janela de 3s.

#### PR-3: Trocar `mode: host` → `mode: ingress` no backend

**Arquivo:** `docker-stack.yml`, serviço `backend`, bloco `ports`:

```yaml
# ANTES (bloqueia multi-réplica):
ports:
  - target: 3000
    published: 3000
    mode: host

# DEPOIS (permite N réplicas com load balancing VIP):
ports:
  - target: 3000
    published: 3000
    mode: ingress   # Swarm routing mesh — distribui entre réplicas
```

**Impacto:** zero impacto no Caddy (que está atrás, usando `backend:3000` via overlay).  
Caddy já usa service discovery do overlay — continua funcionando.

**Atenção:** o Swarm routing mesh (`ingress`) adiciona ~0.3ms de latência vs host-mode.
Para API REST isso é irrelevante. Para WebRTC/WHEP (porta 8889) que está em go2rtc
(não no backend), não muda nada.

#### PR-4: `update_config` para rolling deploy limpo

```yaml
# docker-stack.yml — backend.deploy
deploy:
  replicas: 3
  update_config:
    parallelism: 1        # atualiza 1 réplica por vez
    delay: 15s            # espera 15s entre réplicas
    failure_action: rollback
    order: start-first    # sobe nova antes de derrubar velha (zero-downtime)
  rollback_config:
    parallelism: 1
    failure_action: pause
  restart_policy:
    condition: any
    delay: 5s
    max_attempts: 5
  resources:
    limits:
      memory: 4G
      cpus: '2.0'         # teto por réplica; 3 réplicas = 6 de 8 vCPUs no máx
    reservations:
      memory: 512M
      cpus: '0.5'
```

**Por que `order: start-first`:** evita janela de capacidade zero durante deploy.
Swarm sobe nova réplica, valida health, depois derruba velha.

#### PR-5: SESSION affinity para streaming WHEP (se necessário)

O WHEP (WebRTC live view) usa WebSocket. Se o Caddy distribui entre réplicas
sem sticky session, o cliente pode cair em réplica diferente a cada reconnect.

**Opção A (simples):** Caddy com hash de IP como selector:
```
reverse_proxy backend:3000 {
    lb_policy ip_hash
}
```

**Opção B (correta):** mover o estado de sessão WHEP pra Redis também.  
Hoje o backend é quase stateless para WHEP (go2rtc é quem tem o estado do stream).
Verificar se há qualquer estado de sessão em memória no backend antes de Fase 1.

---

### Mudanças no `docker-stack.yml` — diff completo Fase 1

```diff
  backend:
    image: icv_backend:latest
+   environment:
+     REDIS_URL: redis://redis:6379
    ports:
      - target: 3000
        published: 3000
-       mode: host
+       mode: ingress
    deploy:
-     replicas: 1
+     replicas: 3
      update_config:
        parallelism: 1
-       delay: 10s
+       delay: 15s
        failure_action: rollback
+       order: start-first
+     rollback_config:
+       parallelism: 1
+       failure_action: pause
      resources:
        limits:
-         memory: 4G
+         memory: 4G        # por réplica (total 12G para 3 réplicas)
+         cpus: '2.0'
+       reservations:
+         memory: 512M
+         cpus: '0.5'
```

---

### O que NÃO muda na Fase 1

| Componente | Motivo |
|---|---|
| go2rtc | Aguenta 200+ streams. Porta 1935 fica em mode:host — câmeras conectam direto. |
| postgres | Flat <5% CPU. pgbouncer já faz pool. |
| redis | Já existe. Apenas adiciona 2 hashes (`recorder:active`, `recorder:pending`). |
| tmpfs /recordings | Cada réplica tem seu próprio tmpfs. ffmpeg é filho do processo — não migra entre réplicas. Câmera fica "presa" na réplica que iniciou a gravação (ok). |
| Caddy | Sem mudança. Proxy para backend:3000 já funciona com overlay. |

---

### Validação pós-Fase 1

```bash
# 1. Verificar que 3 réplicas subiram
docker service ps iacloud_backend

# 2. Subir 30 câmeras push via obs-fleet
cd qa/tools/obs-fleet && ./gen-fleet.sh 30 keys.txt
docker compose -f docker-compose.fleet.yml up -d

# 3. Monitorar: nenhum ffmpeg duplicado
watch -n5 'docker exec $(docker ps -q -f name=iacloud_backend) \
  sh -c "ps aux | grep ffmpeg | grep -v grep | wc -l"'

# 4. Reiniciar UMA réplica — gravação deve continuar nas outras
docker service update --force iacloud_backend

# 5. Verificar Redis state direto
docker exec $(docker ps -q -f name=iacloud_redis) \
  redis-cli HLEN recorder:active   # deve mostrar N câmeras ativas
```

---

## Fase 2 — Segundo nó + go2rtc dedicado (300–800 câmeras)

### Quando ativar

Gatilhos objetivos (monitorar via Uptime Kuma / Sentry):
- CPU host médio >65% por >30 minutos
- Active cameras >200 sustentadas
- go2rtc CPU >80% sustained

### Pré-requisitos técnicos

#### PR-6: Provisionar worker node no Hetzner

```bash
# Opções de hardware (escolha baseada no volume):
# CPX31 (4 vCPU / 8 GB / 40 GB SSD) — €18/mês — até ~150 cams adicionais
# CPX41 (8 vCPU / 16 GB / 240 GB SSD) — €30/mês — até ~300 cams adicionais
# CPX51 (16 vCPU / 32 GB / 360 GB SSD) — €65/mês — para pico agressivo

# Criar na mesma região (Falkenstein) pra latência interna <1ms
hcloud server create \
  --name icv-worker-1 \
  --type cpx31 \
  --image ubuntu-24.04 \
  --location fsn1 \
  --ssh-key <key-id>

# Adicionar ao Swarm
docker swarm join --token $(docker swarm join-token worker -q) <manager-ip>:2377
```

#### PR-7: Ajustar placement constraints

```yaml
# docker-stack.yml — separar worker-only e manager-only

# Backend pode rodar em qualquer nó:
backend:
  deploy:
    placement:
      preferences:
        - spread: node.id   # distribui réplicas entre nós

# Postgres, Redis APENAS no manager (têm volume persistente):
postgres:
  deploy:
    placement:
      constraints:
        - node.role == manager

redis:
  deploy:
    placement:
      constraints:
        - node.role == manager
```

#### PR-8: go2rtc em serviço separado (dedicado)

Hoje go2rtc fica no mesmo container stack. Com tráfego alto,
isolar em nó dedicado garante que restart do backend não afeta ingest.

```yaml
# docker-stack.yml — go2rtc no manager, backend nos workers
go2rtc:
  deploy:
    replicas: 1
    placement:
      constraints:
        - node.role == manager   # acesso direto a porta 1935
    resources:
      limits:
        memory: 8G
        cpus: '4.0'
```

#### PR-9: Rede overlay privada entre nós

Já existe (`icv_net: driver: overlay`). Verificar MTU e criptografia:

```yaml
networks:
  icv_net:
    driver: overlay
    attachable: true
    driver_opts:
      encrypted: "true"   # criptografa tráfego inter-nó (VXLAN + IPSec)
```

**Atenção:** `encrypted: true` adiciona ~5-10% overhead CPU no go2rtc por causa
do volume de dados de vídeo. Avaliar se a VPS é em rede privada Hetzner (vnet)
— se sim, a criptografia overlay pode ser desnecessária.

#### PR-10: Sincronização de imagens Docker entre nós

Hoje as imagens `icv_backend:latest` e `icv_frontend:latest` são construídas
localmente no manager. Com worker nodes, os nós precisam ter acesso à imagem.

**Opção A (mais simples) — Registry local no manager:**
```bash
# Subir registry privado no manager
docker run -d -p 5000:5000 --name registry registry:2

# No deploy.sh: tag + push para registry local
docker build -t icv_backend:latest vsaas-backend/
docker tag icv_backend:latest localhost:5000/icv_backend:latest
docker push localhost:5000/icv_backend:latest

# No docker-stack.yml:
image: 127.0.0.1:5000/icv_backend:latest
```

**Opção B (mais robusta) — Cloudflare Registry ou GHCR:**
Usar GitHub Container Registry (ghcr.io) ou registry privado externo.
Melhor para CI/CD futuro.

---

### Capacidade esperada Fase 2

| Configuração | Câmeras simultâneas | CPU total | RAM total |
|---|---|---|---|
| Manager (CPX42) + 1 Worker (CPX31) | ~450 | 12 vCPU | 24 GB |
| Manager (CPX42) + 1 Worker (CPX41) | ~600 | 16 vCPU | 32 GB |
| Manager (CPX42) + 2 Workers (CPX31) | ~750 | 16 vCPU | 32 GB |

---

## Fase 3 — Multi-região (800–3000+ câmeras)

### Arquitetura alvo

```
┌─────────────────────────────────────────────────────────┐
│                   Câmeras do cliente                     │
│  SP (push 100ms)    BSB (push 150ms)    RS (push 120ms) │
└──────┬──────────────────┬──────────────────┬────────────┘
       │                  │                  │
  ┌────▼─────┐      ┌─────▼────┐      ┌─────▼────┐
  │go2rtc SP │      │go2rtc BSB│      │go2rtc RS │   ← PoPs regionais
  │VPS SP    │      │VPS BSB   │      │(futuro)  │   docs/03-PLAN-EDGE
  └────┬─────┘      └─────┬────┘      └──────────┘
       │ RTSP relay        │ RTSP relay
       └──────────┬────────┘
              ┌───▼───────────────────────────────┐
              │  Backend (stateless, N réplicas)   │
              │  Swarm — Manager Falkenstein        │
              └───┬───────────────┬────────────────┘
                  │               │
          ┌───────▼──┐    ┌───────▼──┐
          │ Postgres  │    │  Redis   │
          │ primary + │    │ cluster  │
          │ replica   │    │ (3 nós)  │
          └───────────┘    └──────────┘
                  │
          ┌───────▼──────────┐
          │   R2 Cloudflare  │
          │  (gravações)     │
          └──────────────────┘
```

### Pré-requisitos técnicos Fase 3

#### PR-11: RTMP ingest regionalizado
- Provisionar VPS em São Paulo (Hetzner SP, quando disponível, ou Vultr/DigitalOcean SP)
- go2rtc no PoP SP recebe push da câmera
- go2rtc SP faz RTSP relay pra go2rtc central (Falkenstein): `rtsp://go2rtc-sp:8554/<key>`
- Backend em Falkenstein lê RTSP do relay — gravação continua centralizada
- Latência live view cai de ~400ms → ~80-130ms para clientes SP

> Detalhes completos em `docs/03-PLAN-EDGE-POP-BR.md`

#### PR-12: Postgres read replica
```bash
# Hetzner CX22 (~€4.15/mês) como read replica
# pg_basebackup + streaming replication (built-in PostgreSQL 16)
# Backend: DATABASE_URL aponta pro primário (writes)
#          DATABASE_URL_READ aponta pra réplica (queries timeline, dashboard)
```

#### PR-13: Redis Cluster ou Sentinel
Com Redis em nó único há SPOF. Para Fase 3:
- Redis Sentinel (1 primary + 2 replicas) — HA automático, sem sharding
- Redis Cluster (se >10k cameras — sharding automático)
- Custo: 2 VPS CX11 extras (~€8/mês total)

#### PR-14: pgBouncer por nó (já existe, verificar configuração)
Com N réplicas Node.js, `DEFAULT_POOL_SIZE` precisa ser ajustado:
```
DEFAULT_POOL_SIZE = max_connections_postgres / N_replicas / N_workers
# ex: 100 / 3 réplicas / 2 nós = ~16 conexões por pgBouncer
```

---

## Resumo: o que cada fase exige

| Item | Fase 1 | Fase 2 | Fase 3 |
|---|---|---|---|
| **Código** | Redis state (2-3 dias) | Nenhum | Redis Cluster client |
| **Docker Stack** | mode:ingress + replicas:3 | placement constraints + registry | Multi-stack por região |
| **Infra nova** | Nenhuma (Redis já existe) | 1 VPS worker (~€18-30/mês) | 1-3 VPS PoP regionais |
| **Banco** | Nenhuma | Nenhuma | Read replica (~€4/mês) |
| **Custo mensal extra** | Zero | +€18-30 | +€80-150 |
| **Downtime no deploy** | Zero (rolling) | Zero | Zero |
| **Reversibilidade** | `replicas: 1` + `mode: host` | Remover nó do Swarm | Remover PoP |

---

## Ordem de implementação recomendada

```
1. [AGORA, zero custo]
   PR-2: Redis state no cloud-direct-recorder (~3 dias código)
   PR-3: mode:ingress no backend
   PR-4: update_config com order:start-first
   → Resultado: rolling deploy sem downtime + base para escala horizontal

2. [Quando active cams > 100 sustentadas]
   Subir réplicas: 1 → 2 → 3 (incremental, validar Redis state a cada passo)
   PR-5: avaliar sticky session para WHEP

3. [Quando CPU host > 65% sustained]
   PR-6: provisionar CPX31 worker no Hetzner
   PR-7: placement constraints
   PR-8: go2rtc no manager com limits generosos
   PR-10: registry local no manager

4. [Quando primeiro integrador ISP assinar]
   PR-11: PoP SP (docs/03)
   PR-12: Postgres read replica
   Uptime Kuma em VPS separada (docs/23)
```

---

## Referências

| Documento | Conteúdo |
|---|---|
| `CAPACITY-MODEL.md` | Números medidos empiricamente (CG10/CG12) |
| `docs/03-PLAN-EDGE-POP-BR.md` | PoP regional SP — detalhes de implementação |
| `docs/23-PLAN-STATUS-PAGE-KUMA.md` | Monitoramento com Uptime Kuma |
| `docker-stack.yml` | Stack atual completo |
| `vsaas-backend/src/services/cloud-direct-recorder.service.ts` | Serviço a refatorar (PR-2) |

---

## Histórico

| Data | Por | Mudança |
|---|---|---|
| 2026-05-12 | claude (γ-Day4) | Versão inicial. Baseado em testes empíricos CG10/CG12 e análise do docker-stack.yml atual. |
