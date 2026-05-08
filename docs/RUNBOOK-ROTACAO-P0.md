# Runbook — Rotação dos P0 + Secret Manager

**Status:** 🟡 Pendente (executar antes do 1º integrador piloto externo)
**Audiência:** Tarcísio (executor único)
**Tempo estimado:** 2-3h em janela de manutenção
**Última revisão:** 2026-05-07

> ⚠️ **Pré-requisito de homologação real.** Toda credencial em `docker-stack.yml`
> e em commits `b122d871` / `6aaa945b` está **pública** (mesmo o repo sendo
> privado, qualquer fork/clone preserva). Sem rotação, qualquer pessoa que
> teve acesso ao repo no passado pode acessar prod.

---

## Sequência recomendada (ordem importa)

```
1. Backup completo do DB e R2  (15 min)
2. Rotação P0 — 9 credenciais  (60-90 min)
3. Migração ICV_ENCRYPTION_KEY com dual-key  (30-60 min)
4. Secret Manager para todas credenciais  (45 min)
5. Reescrita do git history  (15 min)
6. Validação pós-rotação  (15 min)
```

Total: **~3h** em janela noturna (downtime real ~10 min entre passos 2 e 3).

---

## Passo 0 — Backup completo (não-negociável)

Antes de qualquer rotação, snapshot do estado atual:

```bash
cd /opt/iacloud-vison

# 1. PostgreSQL
PG=$(docker ps --format '{{.Names}}' | grep iacloud_postgres | head -1)
docker exec $PG pg_dump -U icvuser -d iacloudvision -F c -f /tmp/pre-rotation.dump
docker cp $PG:/tmp/pre-rotation.dump backups/pre-rotation-$(date +%Y%m%d-%H%M%S).dump

# 2. Estado atual do R2 (lista objetos para conferência)
docker exec iacloud_backend.1.* sh -c 'cd /app && node -e "
  const { S3Client, ListBucketsCommand } = require(\"@aws-sdk/client-s3\");
  const s3 = new S3Client({ endpoint: process.env.R2_ENDPOINT, region: \"auto\",
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }});
  s3.send(new ListBucketsCommand({})).then(r => console.log(JSON.stringify(r.Buckets, null, 2)));
"' > backups/r2-buckets-$(date +%Y%m%d-%H%M%S).json

# 3. Snapshot do AnalyticsEvent + RecordingSegment (pra conferir contagem pós)
docker exec $PG psql -U icvuser -d iacloudvision -c "
  SELECT 'AnalyticsEvent' as t, COUNT(*) FROM \"AnalyticsEvent\"
  UNION SELECT 'RecordingSegment', COUNT(*) FROM \"RecordingSegment\";
" > backups/counts-pre-rotation-$(date +%Y%m%d-%H%M%S).txt
```

Confirme que os arquivos foram gerados em `/opt/iacloud-vison/backups/`.

---

## Passo 1 — Rotação das 9 credenciais P0

Para cada credencial, execute em ordem. Após cada uma, **validar com smoke
test antes de prosseguir** para a próxima.

### 1.1 — PostgreSQL password

```bash
# Gerar nova
NEW_PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
echo "Nova senha: $NEW_PG_PASS  (anote em local seguro)"

# Aplicar no DB
docker exec $PG psql -U icvuser -d iacloudvision -c "ALTER USER icvuser WITH PASSWORD '$NEW_PG_PASS';"

# Atualizar Docker secret
echo -n "$NEW_PG_PASS" | docker secret rm db_password 2>/dev/null
echo -n "$NEW_PG_PASS" | docker secret create db_password -

# Atualizar arquivo (será movido pra Secret Manager no Passo 4)
echo "DATABASE_URL=postgresql://icvuser:$NEW_PG_PASS@postgres:5432/iacloudvision" >> /tmp/new-secrets

# Smoke test
docker service update --force iacloud_backend
sleep 30
curl -fsS https://app.iacloud.com.br/health   # deve retornar {"status":"ok"}
```

### 1.2 — R2 Access Key + Secret

```bash
# 1. No Cloudflare dashboard:
#    R2 → Manage R2 API Tokens → criar nova "Object Read & Write"
#    Anotar Access Key ID + Secret Access Key
# 2. Revogar o antigo (mesmo painel)

# 3. Atualizar no servidor
NEW_R2_AK="<colar-access-key>"
NEW_R2_SK="<colar-secret>"

# 4. Smoke test
curl -X POST https://app.iacloud.com.br/storage/test \
  -H "Authorization: Bearer <token-super-admin>"
# Esperado: {"ok":true,"buckets":N}
```

### 1.3 — ICV_ENCRYPTION_KEY (master AES-256) — **CRÍTICO**

Esta chave cifra: `rtspPasswordEnc`, `onvifPasswordEnc`, `rtmpIngestKeyEnc`,
`storageSecretKeyEnc`, etc. Se você trocar sem migração, todas câmeras com
RTSP+senha **param de funcionar**.

**Estratégia dual-key (sem downtime):**

```bash
# Gerar nova chave
NEW_ICV_KEY=$(openssl rand -hex 32)
OLD_ICV_KEY="<chave atual do .env de prod>"

# 1. Rodar script de migração (re-cifra todos campos *Enc com nova chave)
cd vsaas-backend
npx tsx scripts/rotate-encryption-key.ts \
  --old-key=$OLD_ICV_KEY \
  --new-key=$NEW_ICV_KEY \
  --dry-run    # valida primeiro

# Se dry-run OK:
npx tsx scripts/rotate-encryption-key.ts \
  --old-key=$OLD_ICV_KEY \
  --new-key=$NEW_ICV_KEY

# 2. Atualizar variável de ambiente
# (vai pro Secret Manager no Passo 4)
echo "ICV_ENCRYPTION_KEY=$NEW_ICV_KEY" >> /tmp/new-secrets

# 3. Restart + smoke
docker service update --force iacloud_backend
sleep 60
# Verificar que câmera RTSP com senha continua streaming
```

**⚠️ Não deletar `OLD_ICV_KEY` antes de confirmar 7 dias sem incidente.**
Manter como `ICV_ENCRYPTION_KEY_FALLBACK` durante o período (já suportado
por `lib/crypto.ts`).

### 1.4 — VAPID_PRIVATE_KEY (WebPush)

```bash
npx web-push generate-vapid-keys
# Anotar publicKey + privateKey
```

```bash
# Atualizar no env
NEW_VAPID_PUB="<colar>"
NEW_VAPID_PRIV="<colar>"

# Smoke test:
# - Acessar app.iacloud.com.br no browser
# - Browser vai pedir re-subscribe (esperado: VAPID novo invalida antigos)
# - Notificação de teste → deve chegar
```

### 1.5 — EVOLUTION_API_KEY

```bash
NEW_EVO_KEY=$(openssl rand -hex 32)

# Trocar no Evolution (env do container)
# Trocar no backend (env)
docker service update --force iacloud_evolution iacloud_backend

# Smoke
# Enviar mensagem WhatsApp de teste pelo painel /admin/integrations
```

### 1.6 — SMTP_PASS

```bash
# Trocar senha no provedor (mail.iacloud.com.br via painel)
NEW_SMTP_PASS="<nova-senha-do-provedor>"

# Atualizar Docker secret
echo -n "$NEW_SMTP_PASS" | docker secret rm smtp_pass 2>/dev/null
echo -n "$NEW_SMTP_PASS" | docker secret create smtp_pass -

docker service update --force iacloud_backend

# Smoke: solicitar reset de senha em /login → email deve chegar
```

### 1.7 — JWT_SECRET (prod)

⚠️ **Quebra todas as sessões ativas — fazer em janela de manutenção avisada**.

```bash
NEW_JWT=$(openssl rand -base64 48)
echo -n "$NEW_JWT" | docker secret rm jwt_secret 2>/dev/null
echo -n "$NEW_JWT" | docker secret create jwt_secret -

docker service update --force iacloud_backend

# Todos os usuários precisam relogar
# Smoke: login com email/senha funciona
```

### 1.8 — `R2_API_TOKEN` (cfat_)

Este é o token que rodamos durante Sprints 0-5. Já está em `.env.sprint0` —
deve ir pro Secret Manager.

### 1.9 — Outros segredos de menor risco

- `S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY` (Hetzner legado) — só rotacionar se ainda em uso
- `gcp-service-account.json` — se Vertex/BigQuery em uso real

---

## Passo 2 — Secret Manager para `ICV_ENCRYPTION_KEY`

A chave `ICV_ENCRYPTION_KEY` é a mais sensível: cifra todas as outras
credenciais persistidas no DB. Não pode ficar em `docker-stack.yml`
nem em env não-cifrada.

### Opção A — Doppler (recomendado, free tier)

```bash
# 1. Criar conta em https://dashboard.doppler.com (free)
# 2. Criar project "iacloud-vision" + environments dev/staging/prod
# 3. Adicionar secrets:
doppler login
doppler setup -p iacloud-vision -c prd
doppler secrets set ICV_ENCRYPTION_KEY=$NEW_ICV_KEY \
                    R2_API_TOKEN=$R2_TOKEN \
                    R2_ACCESS_KEY_ID=$NEW_R2_AK \
                    R2_SECRET_ACCESS_KEY=$NEW_R2_SK \
                    JWT_SECRET=$NEW_JWT \
                    EVOLUTION_API_KEY=$NEW_EVO_KEY \
                    VAPID_PRIVATE_KEY=$NEW_VAPID_PRIV \
                    SMTP_PASS=$NEW_SMTP_PASS

# 4. Gerar service token (read-only) para o Docker
doppler configs tokens create --plain --name docker-prd

# 5. Atualizar docker-stack.yml: remover env vars, adicionar
#    entrypoint que usa `doppler run -- node dist/index.js`
#    OU usar doppler-cli com inject de env no boot
```

### Opção B — Hetzner Vault (auto-hospedado)

```bash
# Mais complexo, requer container Vault rodando + token de bootstrap.
# Vale a pena se não confiar em terceiros (Doppler é US-baseado).
# Documentação: https://www.vaultproject.io/docs/install
```

### Opção C — Mínimo viável (pé-no-chão)

Mover credenciais de `docker-stack.yml` (rastreado por git) para
**Docker Secrets** (não-rastreado, montado em `/run/secrets/<name>`):

```bash
# Para cada credencial:
echo -n "$VALOR" | docker secret create iacloud_icv_encryption_key -

# No docker-stack.yml:
services:
  backend:
    secrets:
      - iacloud_icv_encryption_key
    environment:
      ICV_ENCRYPTION_KEY_FILE: /run/secrets/iacloud_icv_encryption_key

secrets:
  iacloud_icv_encryption_key:
    external: true
```

E no backend, ajustar `lib/crypto.ts` para ler de arquivo se a env
`*_FILE` estiver presente:

```typescript
const key = process.env.ICV_ENCRYPTION_KEY ??
  (process.env.ICV_ENCRYPTION_KEY_FILE
    ? fs.readFileSync(process.env.ICV_ENCRYPTION_KEY_FILE, 'utf8').trim()
    : null)
```

**Recomendação MVP:** Opção C. Migra pra A ou B quando tiver mais que 5
clientes pagantes.

---

## Passo 3 — Reescrita do git history

Com credenciais antigas rotacionadas, ainda assim limpar o histórico:

```bash
cd /opt/iacloud-vison

# 1. Backup do repo (caso algo dê errado)
git clone --mirror . /tmp/backup-repo.git

# 2. Filter-repo (instalar antes: pip install git-filter-repo)
git filter-repo --invert-paths --path docker-stack.yml --force

# 3. Adicionar docker-stack.yml.example (template sem credenciais)
cp docker-stack.yml docker-stack.yml.example
sed -i 's/icv_evolution_secret/<EVOLUTION_API_KEY>/g; s/6NuBX8WPEmpW.*/<DB_PASSWORD>/g' docker-stack.yml.example
git add docker-stack.yml.example

# 4. .gitignore
echo "docker-stack.yml" >> .gitignore
git add .gitignore
git commit -m "chore: docker-stack.yml fora do git, usar .example"

# 5. Force push (CUIDADO — irreversível em remoto)
# git push --force-with-lease origin --all
# git push --force-with-lease origin --tags
```

---

## Passo 4 — Pre-commit hook anti-segredos

```bash
# Instalar gitleaks
brew install gitleaks  # ou apt
gitleaks --version

# Adicionar pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
gitleaks protect --staged --redact -v
if [ $? -ne 0 ]; then
  echo "❌ Possível segredo detectado. Revise antes de commitar."
  exit 1
fi
EOF
chmod +x .git/hooks/pre-commit

# Testar (deve detectar credencial inserida proposital)
echo 'API_KEY="sk-1234567890abcdef"' > /tmp/test.txt
git add /tmp/test.txt
git commit -m "test"  # deve falhar
git rm --cached /tmp/test.txt
```

---

## Passo 5 — Validação pós-rotação

Lista de smoke tests pra confirmar tudo OK:

| Funcionalidade | Como testar | Esperado |
|---|---|---|
| Backend health | `curl /health` | `{"status":"ok"}` |
| Login | Acessar `/login` | Login funciona |
| Postgres | Query qualquer no painel | Dados aparecem |
| R2 | `POST /storage/test` | `{"ok":true}` |
| Câmera RTSP | Live de qualquer câmera ativa | Stream visível |
| Recording HLS | `/recordings?cameraId=X` | Timeline aparece |
| Vault clips | URL com `?at=YYYY-...` | VaultClipsFallback ou HLS |
| Heartbeat box | Box → cloud | `EdgeNode.lastHeartbeatAt` recente |
| Events box | `POST /iacv-box/events` | 200 + DB tem novo registro |
| Email | Reset de senha | Email chega |
| WhatsApp | Mensagem teste | Recebida |
| WebPush | Notificação | Chega no browser |

Após todos verdes:

```bash
# Marca P0 como resolvidos no checklist
sed -i 's/| ☐ |/| ☑ |/g' docs/PRE-HOMOLOGACAO-CHECKLIST.md  # marca tudo como ☑
# (ou edita manualmente apenas os itens P0 que foram rotacionados)

git commit -am "docs: P0 checklist — 9 credenciais rotacionadas em $(date +%Y-%m-%d)"
```

---

## Em caso de falha — rollback

```bash
# 1. Restaurar Postgres
PG=$(docker ps --format '{{.Names}}' | grep iacloud_postgres | head -1)
docker cp backups/pre-rotation-*.dump $PG:/tmp/restore.dump
docker exec $PG pg_restore -U icvuser -d iacloudvision -c /tmp/restore.dump

# 2. Restaurar credenciais antigas no Docker secrets / env
echo -n "$OLD_DB_PASS" | docker secret create db_password_rollback -
# etc.

# 3. Reverter docker-stack.yml para commit anterior à rotação
git checkout HEAD~1 docker-stack.yml
docker stack deploy -c docker-stack.yml iacloud
```

---

## Histórico de execução

| Data | Quem | Resultado | Nota |
|---|---|---|---|
| _vazio_ | _aguardando 1ª execução_ | _antes do piloto_ | _ver `docs/PRE-HOMOLOGACAO-CHECKLIST.md` para gating_ |
