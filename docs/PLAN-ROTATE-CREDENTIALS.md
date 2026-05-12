# Plano de Rotação de Credenciais P0

**Status:** 📋 Plano pronto — aguardando janela de execução
**Pré-requisito:** Tarcísio precisa ter acesso a R2/Cloudflare, Evolution, SMTP, e janela de manutenção (~30-60min).
**Owner:** Tarcísio (eu, Claude, NÃO posso fazer sozinho — destrutivo).

---

## Por que isso é P0

9 credenciais de produção estão em git history (commits `b122d871` e `6aaa945b`,
arquivo `docker-stack.yml`). Mesmo que o repo vire privado, o histórico contém
as chaves — qualquer fork público ou colaborador antigo retém acesso.

**Risco real se não rotacionado antes do primeiro cliente externo:**
- R2 keys vazados → ladrão pode listar/baixar gravações de todos os clientes
- ICV_ENCRYPTION_KEY vazada → decifra senhas RTSP/ONVIF de **TODAS** as câmeras do banco
- Postgres password → acesso total ao DB
- Evolution API key → envio de WhatsApp se passando pela plataforma
- SMTP pass → spoofing de e-mails @iacloud.com.br
- JWT_SECRET → forjar tokens de qualquer usuário

---

## Ordem de execução recomendada

Da menor pra maior complexidade. Cada item pode ser feito independentemente
em janelas separadas — não há ordem rígida obrigatória, mas há agrupamentos
naturais.

### Fase 1 — Senhas externas (sem downtime, sem migração) · ~30min

Cada uma rotaciona uma credencial **independente** de outras. Pode fazer
isolado e validar antes de seguir.

#### 1.1. SMTP_PASS (~5min)
```bash
# 1. Painel do provedor (mail.iacloud.com.br) → Alterar senha do usuário iacloudvision@
# 2. Atualizar secret file:
echo "NOVA_SENHA_AQUI" > secrets/smtp_pass.txt
# 3. Editar docker-stack.yml linha 286: trocar SMTP_PASS literal pelo valor novo
#    OU migrar pra _FILE / secrets: block (preferido)
# 4. Redeploy:
docker stack deploy -c docker-stack.yml iacloud
# 5. Validar:
curl -X POST https://app.iacloud.com.br/api/auth/forgot-password -d '{"email":"teste@test.com"}'
# E-mail de teste deve chegar
```

#### 1.2. Evolution API key (~5min)
```bash
# 1. Editar docker-stack.yml linha 207 e 291:
sed -i 's/icv_evolution_secret/NOVO_VALOR_LONGO_E_RANDOM/g' docker-stack.yml
# 2. Gerar valor: openssl rand -base64 32 | tr -d /+=
# 3. Redeploy:
docker service update --force iacloud_evolution
docker service update --force iacloud_backend
# 4. Validar: backend consegue chamar /instance/connectionState na Evolution
```

#### 1.3. R2 access keys (~10min)
```bash
# 1. Cloudflare → R2 → Manage R2 API Tokens
# 2. Criar novo token (mesmas permissões: Object Read+Write em todos os buckets icv-*)
# 3. Atualizar docker-stack.yml linhas 306-307:
#    R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY com valores novos
# 4. Redeploy:
docker service update --force iacloud_backend
# 5. Validar: upload de gravação funciona
docker logs $(docker ps -q -f name=iacloud_backend) | grep "R2 upload"
# 6. SÓ DEPOIS de validar: revogar token antigo no Cloudflare
```

#### 1.4. VAPID keys (~10min)
**⚠️ Atenção:** quebra TODAS as inscrições WebPush. Browser precisa re-subscrever.
```bash
# 1. Gerar par novo:
npx web-push generate-vapid-keys
# Output:
#   Public Key: BXxxxxx
#   Private Key: yyyyyy
# 2. Atualizar docker-stack.yml linhas 301-302:
#    VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY
# 3. Truncar tabela de subscriptions (vai limpar inscrições do public key antigo):
docker exec iacloud_postgres.1.xxx psql -U icvuser -d iacloudvision \
  -c "DELETE FROM \"PushSubscription\";"
# 4. Redeploy:
docker service update --force iacloud_backend
# 5. Validar: usuário reabre o app → onesignal/permission prompt aparece → re-subscribe → notif chega
```

### Fase 2 — Postgres password (~10min, breve downtime)

```bash
# 1. Gerar nova senha (sem caracteres especiais que confundem URL escape):
NEWPASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
echo "Nova senha: $NEWPASS"

# 2. Alterar dentro do postgres rodando:
docker exec -it iacloud_postgres.1.xxx psql -U icvuser -d iacloudvision \
  -c "ALTER USER icvuser WITH PASSWORD '$NEWPASS';"

# 3. Atualizar secret file e env vars:
echo -n "$NEWPASS" > secrets/db_password.txt
# Editar docker-stack.yml linhas 123, 215, 268-269 (todas as URLs de conexão)
# Atenção: URL-encode o password se tiver caracteres especiais:
NEWPASS_ENC=$(python3 -c "import urllib.parse; print(urllib.parse.quote_plus('$NEWPASS'))")

# 4. Redeploy backend + evolution (eles têm DATABASE_URL):
docker service update --force iacloud_backend
docker service update --force iacloud_evolution

# 5. Validar:
curl https://app.iacloud.com.br/api/health  # backend
curl https://app.iacloud.com.br/api/integrations/evolution/status  # evolution
```

### Fase 3 — JWT_SECRET (~5min, invalida sessões)

**⚠️ Atenção:** invalida TODOS os JWTs ativos. Todos os usuários precisam relogar.

```bash
# 1. Gerar:
NEWJWT=$(openssl rand -base64 48)
echo "$NEWJWT" > secrets/jwt_secret.txt

# 2. Editar docker-stack.yml linha 270:
#    JWT_SECRET: "$NEWJWT"
# OU melhor: migrar pra secret: jwt_secret (já existe na linha 50!)
#    JWT_SECRET_FILE: /run/secrets/jwt_secret
# E ajustar middleware/auth.ts pra ler do FILE se _FILE existir.

# 3. Redeploy:
docker service update --force iacloud_backend

# 4. Avisar usuários: refresh ou relogin necessário.
```

### Fase 4 — ICV_ENCRYPTION_KEY (~30min, mais complexa) ⚠️

Master AES-256 que cifra `rtspPasswordEnc`, `onvifPasswordEnc`, `rtmpIngestKeyEnc`,
`telegramBotToken`, `gcpServiceAccountJson`, `storageSecretKeyEnc` no DB.

**Estratégia dual-key**: mantém chave velha como `ICV_ENCRYPTION_KEY_OLD`,
nova como `ICV_ENCRYPTION_KEY`. Job de migração lê com OLD, escreve com NEW.

```bash
# 1. Gerar nova chave:
NEW_KEY=$(openssl rand -hex 32)
echo "Nova: $NEW_KEY"

# 2. Backup ANTES de tudo:
/opt/iacloud-vison/scripts/backup-postgres.sh

# 3. Adicionar AMBAS no docker-stack.yml:
#    ICV_ENCRYPTION_KEY: "$NEW_KEY"
#    ICV_ENCRYPTION_KEY_OLD: "0ecfc3823b104bbf47e726a4cac5b1989ee969bc9bd53b677641b72ac88ea284"

# 4. Patch temporário em vsaas-backend/src/lib/crypto.ts:
#    - encrypt() usa ICV_ENCRYPTION_KEY (nova)
#    - decrypt() tenta ICV_ENCRYPTION_KEY, fallback pra ICV_ENCRYPTION_KEY_OLD

# 5. Rodar script de re-encrypt em batch:
docker exec iacloud_backend.1.xxx node -e "
const { prisma } = require('./dist/lib/prisma');
const { encrypt, decryptWithFallback } = require('./dist/lib/crypto');
(async () => {
  // Camera.rtspPasswordEnc
  const cams = await prisma.camera.findMany({ where: { rtspPasswordEnc: { not: null }}});
  for (const c of cams) {
    const plain = decryptWithFallback(c.rtspPasswordEnc);
    await prisma.camera.update({ where: { id: c.id }, data: { rtspPasswordEnc: encrypt(plain) }});
  }
  // Repetir pra: Camera.onvifPasswordEnc, RtmpIngest.urlEnc + keyEnc, Integrador.telegramBotToken,
  // Integrador.storageSecretKeyEnc, etc.
})();
"

# 6. Remover ICV_ENCRYPTION_KEY_OLD do docker-stack.yml.
# 7. Redeploy final, validar câmera RTSP com senha funciona.
```

---

## Pós-rotação — Hardening estrutural (P1)

Depois que TODAS as 7 credenciais P0 estiverem rotacionadas:

1. Migrar todas pra Docker secrets (`secrets:` block + `_FILE` env vars) — não passa via env var (visível em `docker inspect`)
2. `git filter-repo --invert-paths --path docker-stack.yml` — apaga do histórico
3. `git rm --cached docker-stack.yml` + descomentar linha no `.gitignore`
4. Force-push (avisar collaborators primeiro)
5. Marcar tudo como ☑ em `docs/PRE-HOMOLOGACAO-CHECKLIST.md`

---

## Validação final (smoke completo)

Depois de toda rotação, rodar este checklist manual:

- [ ] `curl https://app.iacloud.com.br/api/health` → 200
- [ ] Login com usuário existente → JWT novo emitido
- [ ] Câmera com RTSP+senha → streaming funciona (decifra com nova ICV_ENCRYPTION_KEY)
- [ ] Upload de gravação → R2 recebe (autenticação com novo R2_SECRET)
- [ ] Forgot password → e-mail chega (SMTP novo)
- [ ] WhatsApp test → mensagem enviada (Evolution novo)
- [ ] WebPush test → notif chega após re-subscribe (VAPID novo)
- [ ] `gitleaks detect` no repo todo → 0 leaks
- [ ] `gitleaks detect --no-git --source docker-stack.yml.example` → 0 leaks
- [ ] Marcar 7 P0 como ☑ em `docs/PRE-HOMOLOGACAO-CHECKLIST.md`
- [ ] `git push origin main` → pre-push hook libera (passa pelo guard P0)

---

## Quando executar

Recomendação: **antes** do primeiro integrador piloto entrar em produção.
Janela ideal: madrugada (00:00-02:00 BRT), domingo. Avisar quem for usar
24/7 (Box, alertas) com 24h de antecedência sobre downtime de ~15min.

Tempo total estimado: **~90 minutos** (incluindo backup + smoke completo).
