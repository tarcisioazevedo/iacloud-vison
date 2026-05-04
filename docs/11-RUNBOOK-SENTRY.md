# Runbook Sentry — IA Cloud Vision

## 1. Acesso

| Item | Valor |
|------|-------|
| URL | https://iacloud-vision.sentry.io |
| Org slug | `iacloud-vision` |
| Projetos | `vsaas-backend`, `vsaas-frontend` |
| Tier | Free (5 000 erros/mês, 50 replays, 100 MB attachments) |

Login: SSO via GitHub (workspace iacloud-vision).

---

## 2. Fluxo: alerta chegou, o que fazer

### 2.1 Triagem rápida (< 2 min)

1. Abrir o issue no Sentry.
2. Ler **título**, **stack trace** e **breadcrumbs**.
3. Verificar tags:
   - `environment` — production ou development?
   - `tenant.integradorId` — qual integrador afetado?
   - `request_id` — correlacionar com logs Pino no servidor.
4. Avaliar **frequência** (Events chart) e **Users affected**.

### 2.2 Classificação

| Severidade | Critério | Ação |
|-----------|----------|------|
| **P0 — Fatal** | Backend crash (uncaughtException), dados corrompidos | Fix imediato, deploy hotfix |
| **P1 — Alto** | Feature principal quebrada para >= 1 tenant | Fix em < 24h |
| **P2 — Médio** | Erro intermitente, sem perda de dados | Próximo sprint |
| **P3 — Baixo** | Edge case raro, workaround existe | Backlog |

### 2.3 Atribuição

- Solo dev: Tarcísio (falecomtarcisio@gmail.com).
- Assign o issue no Sentry para rastreamento.
- Se ligado a um issue GitHub: usar "Link GitHub Issue" no Sentry.

### 2.4 Resolve vs Ignore

| Ação | Quando usar |
|------|-------------|
| **Resolve** | Fix deployado e confirmado em produção |
| **Resolve in Next Release** | Fix no próximo deploy (Sentry reabre se regredir) |
| **Ignore** | Erro esperado/inofensivo (ex: bot scan, 404 de asset antigo) |
| **Delete & Discard** | Spam/ruído que nunca vai importar |

---

## 3. Correlação com Pino logs

Cada request tem um `x-request-id` propagado tanto no Sentry (tag `request_id`) quanto nos logs Pino.

```bash
# No servidor, buscar logs correlacionados:
docker service logs iacloud_backend 2>&1 | grep "<request-id>"
```

---

## 4. Integração GitHub Issues

1. No Sentry: Settings > Integrations > GitHub.
2. Conectar repo `iacloud-vision`.
3. Em qualquer issue Sentry: "Link Issue" > criar/vincular issue GitHub.
4. Ao fazer merge do PR que fixa, incluir `Fixes IACLOUD-XXXX` no commit message — Sentry resolve automaticamente.

---

## 5. Alert Rules (configurar manualmente no painel)

### 5.1 Erro novo em production

- **Conditions:** A new issue is created, `environment:production`
- **Action:** Email para falecomtarcisio@gmail.com
- **Frequency:** Once per issue

### 5.2 Crash fatal backend

- **Conditions:** Issue tagged `kind:uncaughtException` OR title contains "uncaught"
- **Filters:** `project:vsaas-backend`, `environment:production`
- **Action:** Email + Slack (se configurado)
- **Frequency:** Every occurrence

### 5.3 Quota 80%

- **Type:** Metric Alert (Spike Protection)
- **Conditions:** When organization error count > 4000 in 24h window
- **Action:** Email admin
- **Note:** Free tier = 5000/mês. 80% = ~4000.

### 5.4 Issue regrediu

- **Conditions:** A previously resolved issue has regressed
- **Action:** Email assignee
- **Frequency:** Once per regression

### 5.5 Release com alta taxa de erros

- **Type:** Metric Alert
- **Conditions:** Error count > 100 in 1h, grouped by release
- **Action:** Email + Slack
- **Frequency:** Every 1h while active

---

## 6. Configuração dos DSNs

### Backend (Docker secret)

```bash
# Criar secret no Swarm:
echo "https://examplePublicKey@o0.ingest.sentry.io/0" | docker secret create iacloud_sentry_dsn_backend -

# No docker-stack.yml, adicionar:
# services.backend.environment:
#   SENTRY_DSN_BACKEND_FILE: /run/secrets/iacloud_sentry_dsn_backend
# services.backend.secrets:
#   - iacloud_sentry_dsn_backend
```

### Frontend (build-time env)

```bash
# No CI ou no build local:
VITE_SENTRY_DSN="https://examplePublicKey@o0.ingest.sentry.io/0" npm run build
```

O DSN do frontend fica no bundle JS — isso é by design (Sentry documenta que DSN de browser projects não é secret).

### Auth Token (CI only)

Para upload de source maps:

1. Sentry > Settings > Auth Tokens > Create New Token
2. Scopes: `project:releases`, `org:read`
3. Salvar como GitHub secret `SENTRY_AUTH_TOKEN`

---

## 7. Replay de sessão (frontend)

- Captura automática quando há erro (`replaysOnErrorSampleRate: 1.0`).
- 50 replays/mês no free tier.
- Dados sensíveis: `maskAllText: false` (desligado) — ajustar se houver PII visível.

---

## 8. Performance / Profiling

- `tracesSampleRate: 0.2` (20% das requests).
- `profilesSampleRate: 0.2` (20% dos traces).
- Ajustar conforme volume. Free tier: 100K transações/mês.

---

## 9. Checklist pós-deploy

- [ ] `SENTRY_DSN_BACKEND` configurado como Docker secret
- [ ] `VITE_SENTRY_DSN` passado no build do frontend
- [ ] `SENTRY_AUTH_TOKEN` configurado no GitHub Secrets
- [ ] `SENTRY_RELEASE` setado para commit SHA no deploy
- [ ] 5 alert rules criadas no painel (seção 5)
- [ ] Integração GitHub ativada (seção 4)
- [ ] Testar: provocar erro 500 e verificar que aparece no Sentry
