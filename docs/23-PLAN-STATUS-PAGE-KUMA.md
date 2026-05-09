# Plan — Status Page Pública (Uptime Kuma)

**Status:** ⏸️ Deferred (decidido em 2026-05-09 — "deixa para um segundo momento")
**Owner:** Tarcísio
**Esforço:** 1 dia (infra + monitors + integração)
**Custo recorrente:** ~€4.51/mês (Hetzner CX11)

---

## Gatilho para retomar

Ativar **antes** de qualquer um destes eventos:

- [ ] Primeiro integrador piloto entrar em produção
- [ ] Primeiro cliente final externo logar
- [ ] SLA contratual (qualquer integrador exigir uptime numérico)
- [ ] Primeiro incidente público (cliente perceber app fora antes de você)

Se **NENHUM** dos quatro aconteceu, deixar parqueado.

---

## Decisão arquitetural

**Uptime Kuma self-hosted em VPS separado.**

Descartadas:
- Status page custom no app — app down = status down (anti-pattern)
- Better Stack / Instatus — $19-29/mês recorrente, vendor lock
- Híbrido Kuma + UI custom — over-engineering pré-MVP

### Por que VPS separado é crítico

Se Kuma roda na mesma VPS Hetzner Falkenstein do app:
- Falkenstein cai → app cai **e** status page cai junto
- Cliente não sabe se é internet dele ou seu
- Status page **DEVE** estar fora do blast radius

VPS recomendada: **Hetzner CX11 em Nuremberg ou Helsinki** (não Falkenstein).

---

## Proposta concreta (1d)

### Infra (~30min)

```
Hetzner CX11 (€4.51/mês)
  Datacenter: Nuremberg (NBG1) ou Helsinki (HEL1)
  Especificações: 1 vCPU · 2GB RAM · 20GB SSD
  OS: Ubuntu 24.04 LTS
```

DNS Cloudflare:
```
status.iacloud.com.br  A   <IP do CX11>  (proxy off — Kuma faz TLS direto)
```

Stack no CX11:
- Docker + Docker Compose
- Caddy (TLS automático Let's Encrypt)
- Uptime Kuma (`louislam/uptime-kuma:latest`)

### Monitors a configurar

| Tipo | Target | Intervalo | Tags |
|---|---|---|---|
| HTTPS | `https://app.iacloud.com.br` | 60s | frontend |
| HTTPS | `https://app.iacloud.com.br/api/health` | 60s | backend |
| TCP | postgres:5432 (via SSH tunnel ou push) | 60s | database |
| RTMP/RTSP | ingest endpoint | 120s | ingest |
| Push | backend heartbeat → Kuma cada 60s | — | backend-internal |
| HTTPS | evolution-api endpoint | 120s | notifications |
| HTTPS | go2rtc endpoint | 60s | streaming |
| Cert | TLS expiry app.iacloud.com.br | 24h | security |

### Status page pública (~30min)

URL: `https://status.iacloud.com.br`

Componentes (agrupados):
- **Plataforma** — Frontend · API · Database
- **Streaming** — go2rtc · RTMP Ingest · Recordings
- **IA** — Vertex Vision · Vision API · Edge processing
- **Notificações** — Email (SMTP) · WhatsApp (Evolution) · WebPush

Configurações:
- Histórico: 90 dias visível
- Uptime % por componente
- Branded: logo IACV + cores do tema
- Subscribe via email/RSS para incidentes
- Locale pt-BR

### Alertas (1-2h)

- **Telegram** → Tarcísio (combina com plano OpenClaw Ops deferred em `docs/04`)
- **Email** → admin@iacloud.com.br
- **Webhook** → Sentry (correlacionar com erros de app)

### Integração com app interno (1-2h)

1. Endpoint `/health` no backend (criar se não existir):
   ```ts
   app.get('/health', async (req, res) => {
     const dbOk = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)
     res.status(dbOk ? 200 : 503).json({
       status: dbOk ? 'healthy' : 'degraded',
       database: dbOk,
       uptime: process.uptime(),
     })
   })
   ```

2. Push heartbeat do backend → Kuma:
   ```ts
   setInterval(async () => {
     await fetch('https://status.iacloud.com.br/api/push/<TOKEN>?status=up&msg=ok')
       .catch(() => {})
   }, 60_000)
   ```

3. Banner no frontend em caso de 5xx:
   ```tsx
   {hasApiError && (
     <a href="https://status.iacloud.com.br" target="_blank">
       ⚠️ Estamos investigando — veja status
     </a>
   )}
   ```

4. Link "Status" no footer/sidebar.

---

## Checklist de execução (quando retomar)

- [ ] Provisionar Hetzner CX11 em Nuremberg ou Helsinki
- [ ] Configurar firewall (apenas 80/443/22)
- [ ] Apontar DNS `status.iacloud.com.br`
- [ ] Subir docker-compose com Caddy + Kuma
- [ ] Configurar 7 monitors iniciais
- [ ] Configurar status page pública (componentes + branding)
- [ ] Integrar Telegram alerta
- [ ] Adicionar endpoint `/health` no backend
- [ ] Adicionar push heartbeat backend → Kuma
- [ ] Adicionar link "Status" no footer
- [ ] Adicionar banner no frontend para 5xx
- [ ] Testar: derrubar 1 monitor, ver alerta Telegram
- [ ] Documentar credenciais de admin do Kuma no 1Password

---

## Custos consolidados

| Item | Mensal | Anual |
|---|---|---|
| Hetzner CX11 (Nuremberg/Helsinki) | €4.51 | €54.12 |
| Domínio (já tem) | — | — |
| Cloudflare DNS (free tier) | — | — |
| **Total** | **€4.51/mês** | **€54.12/ano** |

Equivalente a R$ 25-30/mês ao câmbio de 2026-05-09.

---

## Quando retomar, perguntar:

- Você já tem CX11 separado provisionado, ou quero passar os passos de bootstrap?
- Vai integrar com Telegram (plano `docs/04` OpenClaw Ops) ou só email por enquanto?
- Quer status page totalmente pública ou só pra integradores autenticados?
