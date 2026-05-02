# Checklist Pré-Homologação — Rotação de Credenciais & Hardening

**Status atual:** 🟢 **DEV / DESENVOLVIMENTO**
**Data limite para executar:** **antes do primeiro acesso de cliente externo (integrador piloto)**
**Owner:** Tarcísio

> ⚠️ **NÃO COLOCAR EM HOMOLOGAÇÃO COM ESTE CHECKLIST PENDENTE.**
>
> Toda credencial em produção precisa ser **diferente** das que estão em git/dev hoje.
> Referência completa: `docs/00-INVESTIGACAO-PRE-MVP.md` seção 4 (lista de 17 segredos).

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
| ☐ | **Remover `docker-stack.yml` do git tracking** | `git rm --cached docker-stack.yml` + adicionar ao `.gitignore` + criar `docker-stack.yml.example` | Evita re-commit acidental de credenciais |
| ☐ | **Reescrever git history** para apagar credenciais antigas | `git filter-repo --invert-paths --path docker-stack.yml` (BFG ou git-filter-repo) | Remove de `git log -p` mesmo que repo seja clonado |
| ☐ | **Force push após filter-repo** | `git push --force-with-lease origin --all` | Aplica reescrita no remote |
| ☐ | **Migrar todas credenciais para Docker secrets** | Editar `docker-stack.yml`: usar `_FILE` + `secrets:` block (já existe pra DB/SMTP/JWT — expandir pra R2, Evolution, ICV_ENCRYPTION_KEY, VAPID) | Não passa credencial via env var (visível em `docker inspect`) |
| ☐ | **Pre-commit hook anti-segredos** | Instalar `gitleaks` ou `trufflehog` em `.git/hooks/pre-commit` | Bloqueia novo commit com credencial |
| ☐ | **Backup automatizado do PostgreSQL** | Cron diário com `pg_dump | gzip` + upload pro R2/S3 | Sem isso, perda total se volume corromper |
| ☐ | **Log rotation no Docker daemon** | `/etc/docker/daemon.json` com `log-opts max-size=50m max-file=3` | Provável ofensor dos 50/75 GB de disco já usados |
| ☐ | **`RECORDING_DELETE_LOCAL_AFTER_S3=true`** | `secrets/s3.env:7` (atualmente `false`) | Disco da VPS não cabe câmeras reais sem isso |
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
| ☐ | CORS: remover wildcard de redes privadas (`192.168.*`, `10.*`) | `app.ts:78-79` |
| ☐ | Mosquitto MQTT: habilitar autenticação | `deploy.sh:86-91` (hoje `allow_anonymous true`) |
| ☐ | Backend produção: voltar a usar `tsc` em vez de `tsx` | Corrigir erros TS6059 antes |

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
