# Checklist Pré-Homologação — Rotação de Credenciais & Hardening

**Status atual:** 🟢 **DEV / DESENVOLVIMENTO**
**Data limite para executar:** **antes do primeiro acesso de cliente externo (integrador piloto)**
**Owner:** Tarcísio

> ⚠️ **NÃO COLOCAR EM HOMOLOGAÇÃO COM ESTE CHECKLIST PENDENTE.**
>
> Toda credencial em produção precisa ser **diferente** das que estão em git/dev hoje.
> Referência completa: `docs/00-INVESTIGACAO-PRE-MVP.md` seção 4 (lista de 17 segredos).

---

## 🔴 P0 — Continuidade de gravação (descoberto 2026-05-08)

| # | Achado | Evidência | Onde corrigir | Validação |
|---|--------|-----------|---------------|-----------|
| ☐ | **Pipeline grava 60% wall-clock** (segments de 6s + ~4s gap entre eles) | 1100/1107 gaps em 2-5s na camera1 (auditoria 2026-05-08). Padrão idêntico em 2026-05-07 (2117/2121). Cobertura real **40% menor** que aparente. | Box: ffmpeg/go2rtc — segments precisam ser contíguos (`startedAt(N+1) - endedAt(N) < 200ms`) | SQL `gap_sec` agrupado deve mostrar > 99% em 0-1s |
| ☐ | **Pipeline colapsa às 03:00 UTC** (00:00 BRT) e tenta restart inútil a cada ~2h | 4 buracos no dia 2026-05-08: 5h39, 2h, 1h34, 2h. Bursts pós-blackout duram só 30-90s e param. | Box: investigar logs go2rtc/Frigate ao redor de 03:00 UTC. Cron do host? Restart Docker? Cert TLS? | Câmera grava 24/7 sem intervenção por ≥48h consecutivas |
| ☐ | **`hasMotion=false` em 100% dos segments** apesar de `recordMode=MOTION` | 1107 segs hoje, 2122 ontem — todos `hasMotion=false`, mas `hasEvent=true` em ~25% (analítica funciona) | Box: popular `hasMotion: true` no `POST /iacv-box/segments/register` quando frame tiver motion. Schema Cloud já aceita. | Filtro "Motion" na timeline UI mostra resultado |

**Bridge:** PEDIDO completo + cronologia + SQL de auditoria em `INTEGRATION/CLOUD_TO_BOX.md` seção `[CLOUD 2026-05-08 18:30]`.

**Por que P0:** sem isso, cliente paga "VMS 24h" e recebe 7-14% de footage por dia. Forensics com micro-gaps de 4s perde evidência aleatoriamente.

**Cosmético do Cloud já entregue (não substitui o fix Box):**
- ☑ Endpoint `/playback/:id/timeline` agora expõe `realCoverageSec`, `realCoveragePct` e `gaps[]`
- ☑ Painel mostra cobertura real + badge âmbar quando aparente difere >10% + badge rose com nº de macro-gaps
- ☑ Timeline renderiza listras hachuradas rose nos macro-gaps pra alertar antes do click

---

## 🔴 P0 — Rotação obrigatória (não negociável)

| # | Credencial | Onde está exposta | Como rotacionar | Validação |
|---|-----------|-------------------|-----------------|-----------|
| ☐ | **PostgreSQL password** (`6NuBX8WPEmpW…`) | `docker-stack.yml:161,207-208` | `ALTER USER icvuser WITH PASSWORD '<novo>'` + atualizar Docker secret `db_password` + redeploy | `psql -U icvuser` com nova senha |
| ☐ | **ICV_ENCRYPTION_KEY** (master AES-256) | `docker-stack.yml:234` | Gerar nova: `openssl rand -hex 32`. **Atenção:** re-cifrar todos os `*Enc` no DB (rtspPasswordEnc, onvifPasswordEnc, rtmpIngestKeyEnc, rtmpPushUrlEnc, telegramBotToken, gcpServiceAccountJson, storageSecretKeyEnc). Estratégia dual-key durante migração. | Câmeras com RTSP + senha continuam funcionando após rotação |
| ☐ | **R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY** | `docker-stack.yml:241-242`, `.env:52-53` | Cloudflare → R2 → API Tokens → revogar atual + criar novo | Upload de gravação para R2 funciona |
| ☐ | **VAPID_PRIVATE_KEY** | `docker-stack.yml:237` | `npx web-push generate-vapid-keys` → atualizar VAPID_PUBLIC_KEY + PRIVATE_KEY. **Quebra:** todos os browsers precisam re-subscrever WebPush. | Notificação push de teste chega |
| ☐ | **EVOLUTION_API_KEY** (`icv_evolution_secret`) | `docker-stack.yml:157,229`, `.env:48` | Trocar `AUTHENTICATION_API_KEY` no Evolution + atualizar backend + restart Evolution | WhatsApp envia mensagem de teste |
| ☐ | **SMTP_PASS** | `docker-stack.yml:224` (`w9_UPq77hDJ~`), `.env:41` (`b1[XH#AdKEoQ` — diferente!) | Trocar senha no provedor `mail.iacloud.com.br` → atualizar Docker secret `smtp_pass` | E-mail de recuperação de senha chega |
| ☐ | **JWT_SECRET (prod)** | `secrets/jwt_secret.txt` (não em git, mas pode estar fraco) | Gerar novo: `openssl rand -base64 48` → atualizar Docker secret. **Quebra:** invalida todas as sessões ativas. Fazer em janela de manutenção. | Login funciona com sessão nova |

---

## 🟡 P1 — Hardening estrutural (deve ser feito antes de homologação)

| # | Ação | Comando / Onde | Por quê |
|---|------|----------------|---------|
| ◐ | **`docker-stack.yml.example` sanitizado criado** (2026-05-12) — `.example` 100% limpo via `sed`. `.gitignore` preparado com bloco comentado. **Não ativei `git rm --cached` ainda** porque P0 de credencial pendente — sequência segura está documentada inline. | Ver `.gitignore` linhas 11-22 + `docker-stack.yml.example` no root | Pronto pra ativar após P0 |
| ☐ | **Reescrever git history** para apagar credenciais antigas | `git filter-repo --invert-paths --path docker-stack.yml` (BFG ou git-filter-repo) | Remove de `git log -p` mesmo que repo seja clonado |
| ☐ | **Force push após filter-repo** | `git push --force-with-lease origin --all` | Aplica reescrita no remote |
| ◐ | **Migrar credenciais para Docker secrets** — parcial 2026-05-12 | `vsaas-backend/src/lib/secrets-bootstrap.ts` + `docker-stack.yml`: **9 credenciais migradas** (JWT_SECRET, SMTP_PASS, DB_PASSWORD, EVOLUTION_API_KEY, ICV_ENCRYPTION_KEY, VAPID_PUBLIC/PRIVATE, R2_ACCESS/SECRET) + DATABASE_URL/DIRECT_URL via template. `docker service inspect iacloud_backend` ➔ **0 credenciais inline, 15 _FILE/_TEMPLATE**. Pendente: Evolution service ainda inline (imagem 3rd-party não suporta _FILE nativamente — TODO criar wrapper). |
| ☑ | **Pre-commit hook anti-segredos** (2026-05-12) | `scripts/git-hooks/pre-commit` + `.gitleaks.toml` + `scripts/bin/gitleaks` (8.18.4). Ativado via `bash scripts/git-hooks/install.sh`. | `git commit` tentando adicionar credencial é BLOQUEADO |
| ☑ | **Backup automatizado do PostgreSQL** (2026-05-12) | `scripts/backup-postgres.sh` + crontab `30 3 * * *`. Retenção 7d. Output `/opt/iacloud-vison/logs/icv-backup.log`. | Smoke test rodado: 25MB gerado em ~4s. **Pendente:** upload R2 (depende rotação P0) |
| ☑ | **Log rotation no Docker daemon** (descoberto já configurado 2026-05-12) | `/etc/docker/daemon.json` já tem `max-size=50m max-file=3` | `cat /etc/docker/daemon.json` confirma |
| ☐ | **`RECORDING_DELETE_LOCAL_AFTER_S3=true`** | `secrets/s3.env:7` (atualmente `false`) | Disco da VPS não cabe câmeras reais sem isso |
| ☑ | **Liberação de disco** (2026-05-12) | `docker builder prune -af` → 38.55 GB · `docker image prune -af` → 961 MB · containers exited → 15 MB · volumes `icv_*` legacy (pré-rebrand) → 7.5 GB · volumes anônimos → 70 MB. **Total: 47 GB liberados**. Disco: 85% → **19%**. | Capacidade pra escalar 30-50 câmeras HD sem aperto |
| ☐ | **Verificar forks públicos do repo** | https://github.com/tarcisioazevedo/iacloud-vison/network/members | Forks públicos preservam credenciais mesmo após repo virar privado |
| ☐ | **Confirmar repo está privado no GitHub** | Settings → Danger Zone → "Make private" | Reduz exposição imediata |

---

## 🟢 P2 — Boas práticas (recomendado mas não bloqueante)

| # | Ação | Notas |
|---|------|-------|
| ☐ | Rotacionar `S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY` (Hetzner) em `secrets/s3.env` | Só se Hetzner Object Storage for usado em prod |
| ☐ | Trocar `JWT_SECRET` de dev (`icv_local_secret`) por valor random | Baixo impacto (dev local) |
| ☐ | Trocar DB password de dev (`icvpass`) | Baixo impacto |
| ☐ | Configurar GCP Service Account real em `gcp-service-account.json` | Hoje é `{}` — Vertex/Cloud Vision/BigQuery silenciosamente falham |
| ☑ | CORS: remover wildcard de redes privadas (`192.168.*`, `10.*`) — **feito 2026-05-12** | `vsaas-backend/src/app.ts:112-148`. Whitelist explícita + opt-in via `ICV_CORS_PRIVATE_NETWORK=1` pra ambiente de campo. |
| ☐ | Mosquitto MQTT: habilitar autenticação | `deploy.sh:86-91` (hoje `allow_anonymous true`) |
| ☐ | Backend produção: voltar a usar `tsc` em vez de `tsx` | Corrigir erros TS6059 antes |

---

## 🔵 Operacional Box (do bridge `INTEGRATION/CLOUD_TO_BOX.md` — Onda 2)

Estes itens são **necessários para o instalador do Box funcionar via curl simples**
(`curl -fsSL https://get.iacloud.com.br | sudo bash`). Não bloqueiam o painel cloud
em si, mas bloqueiam o fluxo end-to-end Box→Cloud para integrador piloto.

| # | Ação | Quem | Comando / Onde | Validação |
|---|------|------|----------------|-----------|
| ☐ | Criar repo público `iacloud-vision/box-installer` no GitHub | Tarcísio | github.com → New repository → public | Repo aceita push de `box-installer/install.sh` |
| ☐ | Criar Deploy Key SSH e adicionar como secret `BOX_INSTALLER_DEPLOY_KEY` | Tarcísio | `ssh-keygen -t ed25519 -f /tmp/key -N ""` → adicionar pública em Deploy keys do repo público com **write** + privada como Actions secret deste monorepo | `.github/workflows/box-installer-publish.yml` consegue dar push |
| ☐ | Configurar DNS `get.iacloud.com.br` → CNAME para Cloudflare Pages OU caddy estático | Tarcísio | Cloudflare DNS · ver `box-installer/PUBLISH.md` para opções | `curl -fsSL https://get.iacloud.com.br/install.sh \| head` retorna o script |
| ☐ | Rodar `npx prisma migrate deploy` aplicando `20260504_edge_command_ack_enriched` (ACK enriquecido bridge) | Tarcísio | `cd vsaas-backend && npx prisma migrate deploy` | Tabela `EdgeCommand` tem colunas `durationSec`, `errorMessage`, `info` |
| ☐ | Rodar `npx prisma migrate deploy` aplicando `20260506_integrador_theme` (Onda 8 cockpit) | Tarcísio | `cd vsaas-backend && npx prisma migrate deploy` | Tabela `IntegradorTheme` existe; `GET /me/integrador/theme` retorna defaults |
| ☐ | Build + deploy backend e frontend (após migrations acima) | Tarcísio | rotina padrão de deploy | Painel novo `/integrador/theme` carrega para INTEGRADOR_ADMIN |
| ☐ | Testar fluxo end-to-end Box piloto: provisionar Box no painel → QR → curl install em VM limpa → ativação OK → heartbeat com `enforcedModules` → módulo drift visível no painel | Tarcísio | painel admin → Provisionar Box | Box conectado e visível em `/edge` com sparkline CPU/RAM |

---

## 🟢 Storage Hardening (Sprint 5) — pré-piloto

Itens específicos do subsistema de Storage que ficam fora dos P0/P1 globais
mas devem estar OK antes de abrir piloto.

| # | Ação | Estado | Onde |
|---|------|--------|------|
| ☑ | **Bucket-per-integrador validado em produção** | OK Sprint 0 | `INTEGRATION/sprint0-evidences/` |
| ☑ | **Lifecycle date-based + age-based** | OK Sprint 0 | `r2-storage.service.ts:setLifecycleRule` |
| ☑ | **Bucket Lock prefix-based** (LGPD 30d graça pós-cancelamento) | OK Sprint 0 + Sprint 1 hooks | `ClienteFinal.canceledAt/cancelGraceUntil` |
| ☑ | **Event Notifications via Cloudflare Queue** | OK Sprint 0 (cloud-side); ⚠️ falta `R2_QUEUE_ID` em prod | `r2-event-consumer.service.ts` |
| ☑ | **Catálogo de planos (34 planos seedados)** | OK Sprint 2 | `prisma/seed-retention-plans.ts` |
| ☑ | **Auto-aprovação híbrida + downgrade Opção 3** | OK Sprint 4 | `IntegradorRetentionContract` |
| ☑ | **Painel de margem (SA + INT + CF)** | OK Sprint 4 | `BillingPage.tsx`, `routes/billing.ts` |
| ☑ | **Reconciliação Cloudflare via GraphQL** | OK Sprint 4; depende `Account Analytics:Read` no token | `storage-billing-reconciliation.service.ts` |
| ☑ | **HLS Recording fim-a-fim Box→Cloud** | OK 2026-05-07 (Box commit 17873e2 + cloud 836+ segmentos uploaded) | `iacv-box-segments.ts` + `recording_uploader.py` |
| ☐ | **R2_QUEUE_ID configurado em prod** | Pendente | `.env` prod + Event Notifications subscription nos buckets |
| ☐ | **Custom Domain por integrador (white-label)** | Sprint 5 em curso | `Integrador.customDomain` + integração CF Custom Hostnames |
| ☐ | **Health summary cron + dashboard** | Sprint 5 em curso | novo `health-summary-cron.service.ts` |
| ☐ | **`RECORDING_DELETE_LOCAL_AFTER_S3=true` em prod** | Pendente | `secrets/s3.env:7` (atualmente `false` — disco da VPS estoura) |
| ☐ | **Soak test 7 dias monitorando métricas** | Pendente | métricas: # snapshots/dia, drift CF, recording_upload taxa, vault_upload taxa |
| ☐ | **STORAGE-OPERATION-RUNBOOK.md** | Sprint 5 em curso | Como rodar snapshot manual, reconciliar, fechar mês, debug drift |

---

## ✅ Resolvidos em definitivo (histórico)

| Data | Item | Como foi resolvido |
|------|------|---------------------|
| 2026-05-06 | **IDs legacy slug** (`int-iacloud-001`, `cf-*`, `site-*`, `en-*`, `usr-*`) causando "Invalid uuid" em endpoints com `z.string().uuid()` | Migração transacional via `scripts/migrate-legacy-ids-to-uuid.sql`. Todos os 7 registros raiz (1 Integrador + 2 ClienteFinal + 2 Site + 1 EdgeNode + 1 User) ganharam UUIDs gerados pelo Postgres. Como TODAS as ~40 FKs têm `ON UPDATE CASCADE`, Postgres atualizou automaticamente todas as tabelas filhas. Backup pré-migração em `backups/pre-uuid-migration-*.dump`. Validação pós: 0 IDs legacy + 0 FKs órfãs + counts batem. Schema voltou ao limpo (`z.string().uuid()` estrito em users.ts e impersonation.ts). Seed (`prisma/seed.ts`) atualizado para gerar UUIDs via `@default(uuid())` em vez de slugs hardcoded. **Efeito colateral:** JWTs ativos com `sub` antigo (ex.: `usr-superadmin-001`) ficam inválidos — usuário precisa relogar (login funciona por email, não por id). |
| 2026-05-07 | **Storage subsystem fim-a-fim entregue** (Sprints 0-4) | (a) Sprint 0: validação técnica R2 (bucket WEUR, lifecycle, bucket lock, event notifications, custom domain) — `INTEGRATION/sprint0-evidences/`. (b) Sprint 1: visibilidade — `r2-event-consumer` + `storage-reconciliation` crons + StorageTab CF dashboard. (c) Sprint 2: catálogo de 34 planos + IntegradorRetentionContract + 3 hooks de schema (criticality, customDomain, canceledAt). (d) Vault clips fallback (`VaultClipsFallback`) + spec `INTEGRATION/HLS_RECORDING_INTEGRATION.md` que destravou Box-side. Box implementou em ~3h: 836 RecordingSegment uploaded primeiro dia. (e) Sprint 4: billing snapshot (3 crons: daily + finalize + reconciliation GraphQL CF) + auto-approve híbrido + downgrade Opção 3 + 3 painéis de margem (SA/INT/CF). (f) 3 fixes bloqueantes para Box: UPSERT events-batch + bug 403 snapshots-live + merge sprint0-pivot já estava em dev. Migrations: 20260514_storage_visibility_hooks, 20260515_retention_catalog, 20260516_billing_snapshots. |

---

## Como vou te lembrar disso

3 camadas de defesa, em ordem crescente de "rigidez":

1. **`CLAUDE.md` na raiz** — instrução automática para o Claude em toda sessão.
   Quando você disser "vamos pra homologação", "vamos pro piloto", "deploy de produção" etc.,
   eu paro e abro este checklist antes de prosseguir.

2. **Git hook `pre-push`** (`scripts/git-hooks/pre-push`) — bloqueia automaticamente
   `git push origin main` ou `git push origin master` enquanto houver itens P0 com `☐`.
   Push para `dev` ou feature branches continua livre.
   - Ativação (1x por clone novo): `bash scripts/git-hooks/install.sh`
   - Override consciente (com auditoria): `ICV_FORCE_PUSH=1 git push`
   - Bypass total: `git push --no-verify` (não recomendado)

3. **Este checklist** — fonte da verdade. Marque `☐` → `☑` quando rotacionar
   cada credencial. Quando os 7 P0 estiverem todos ☑, o hook libera o push pra `main`
   automaticamente (P1 e P2 podem ir sendo feitos ao longo do piloto sem bloquear).

---

## Histórico

| Data | Evento |
|------|--------|
| 2026-05-02 | Checklist criado. Status: dev. 9 credenciais em git, repo aguardando virar privado. |
| 2026-05-06 | Adicionada seção "🔵 Operacional Box" com 7 itens do bridge Cloud↔Box (Onda 2 do `docs/08`) e deploys de migration `20260506_integrador_theme` (Onda 8 cockpit). Não-bloqueante para painel cloud, mas necessário para integrador piloto end-to-end. |
| 2026-05-07 | Sprints 0-4 do **Storage** entregues e deployados em produção (5 commits). Box-side respondeu em <12h com HLS Recording Uploader (caminho B + C presigned). Adicionada seção "🟢 Storage Hardening (Sprint 5)" com 6 itens (3 ☑ entregues + 6 ☐ pendentes). **P0 globais permanecem inalterados** — rotação das 9 credenciais ainda é pré-requisito de homologação real. Reconciliação Cloudflare via GraphQL pronta. |
| 2026-05-12 | **Rebranding VSaaS** completo (logos, tokens, sidebar always-dark, cobertura claro/escuro ~92%) e onda de hardening P1: pre-commit hook gitleaks 8.18.4 + `.gitleaks.toml` com regras custom VSaaS · backup PostgreSQL diário 03:30 com retenção 7d (smoke OK, 25MB) · CORS hardening removeu wildcards `192.168/10.*` (opt-in via env) · `docker-stack.yml.example` sanitizado · plano detalhado de rotação P0 em `docs/PLAN-ROTATE-CREDENTIALS.md`. **Pendente humano:** rotação das 7 credenciais (R2/Evolution/SMTP/Postgres/JWT/ICV_ENCRYPTION_KEY/VAPID — eu, Claude, não posso fazer sozinho). |
| 2026-05-12 (tarde) | **Migração credenciais → Docker secrets** (9 de 10). `vsaas-backend/src/lib/secrets-bootstrap.ts` lê `*_FILE` no startup e popula `process.env.*` automaticamente. DATABASE_URL/DIRECT_URL montadas via template `$${DB_PASSWORD}` no YAML (escape `$$` evita interpolação prematura do Docker Compose). Bug: primeiro deploy crashou porque o `${DB_PASSWORD}` foi substituído por string vazia no parse; fix: escape `$$`. **Resultado:** `docker service inspect iacloud_backend` agora retorna **0 credenciais inline** (antes: 9). Evolution continua inline (imagem 3rd-party — TODO criar wrapper). |
