# Runbook WhatsApp — Evolution API + Provedores Alternativos

**Última atualização:** 2026-05-06
**Owner:** Tarcísio
**Vínculos:** `vsaas-backend/src/routes/notifications.ts`, `vsaas-backend/src/routes/admin-notifications.ts`, `vsaas-evolution/Dockerfile`

---

## TL;DR — Estado atual

| Provider | Status | Quem usa |
|---|---|---|
| **Evolution API (self-hosted, Baileys)** | 🔴 **QR não emite — bloqueio externo** | Cliente final (instâncias por cliente) + super-admin (singleton) |
| **Twilio WhatsApp Business API** | 🟢 Operacional (não testado em prod recente) | Configurar via Settings → Notificações → WhatsApp → Provider Twilio |
| **Meta Cloud API** | 🟢 Operacional (não testado em prod recente) | Configurar via Settings → Notificações → WhatsApp → Provider Meta |

---

## 1. Por que o Evolution não emite QR

**Causa raiz:** A faixa IPv6 da VPS Hetzner (`2a01:4f8::/32`, datacenter Falkenstein-1) está listada pelo WhatsApp como **datacenter IP**. O WhatsApp Web rejeita registration de novos dispositivos vindo de IPs de datacenter conhecido — o handshake do Baileys (lib que o Evolution usa) é abortado pelo servidor antes do QR ser gerado.

**Sintoma nos logs do `iacloud_evolution`:**
```
INFO  [ChannelStartupService]  Baileys version env: 2,3000,1015901307
INFO  helloMsg: { clientHello: { ephemeral: "..." } }  msg: connected to WA
INFO  msg: not logged in, attempting registration...
WARN  msg: connection errored
      Error: Connection Failure
        at WebSocketClient.<anonymous> (.../baileys/lib/Socket/socket.js:524)
        at .../baileys/lib/Utils/noise-handler.js:144
```

**O que NÃO resolve** (já testado em 2026-05-06):

- ✗ Atualizar Baileys da imagem oficial (`6.7.12` → `6.7.18` via `vsaas-evolution/Dockerfile`)
- ✗ Atualizar imagem Evolution para `:latest` (Baileys 6.7.12 mesmo na latest)
- ✗ Mudar `CONFIG_SESSION_PHONE_VERSION` para a versão atual do WhatsApp Web (`2,3000,1035194821`)
- ✗ Limpar volume `evolution_instances` + `TRUNCATE Instance` no banco
- ✗ Forçar reconnect/restart

**O que resolveria** (não testado, requer recursos externos):

1. **Plugar proxy residencial** via env `PROXY_HOST` + `PROXY_PORT` + `PROXY_USERNAME` + `PROXY_PASSWORD` no Evolution. O egress do Baileys passa por IP residencial e o WhatsApp aceita o handshake. Custo: serviço de proxy residencial (~$50-100/mês) + queda de latência.
2. **Migrar para Twilio ou Meta Cloud API** — ambos usam endpoints oficiais do Meta (não emulam dispositivo via Baileys), então funcionam em qualquer datacenter. Trade-off: pago (Twilio) ou requer aprovação Meta (Cloud API), mas confiabilidade altíssima.
3. **Mover Evolution para outro VPS** com IP residencial ou de datacenter "limpo" (não trivial, e o "limpo" é efêmero — WhatsApp atualiza listas constantemente).

---

## 2. Histórico do diagnóstico (2026-05-06)

A sessão de diagnóstico encontrou DOIS problemas em série:

### 2.1 Schema da DB ausente (resolvido)

`docker-stack.yml` apontava `DATABASE_CONNECTION_URI` para a DB `iacloudvision` (do nosso VSaaS), que **nunca recebeu** as 49 migrations Prisma do Evolution. O serviço subia OK mas qualquer `POST /instance/create` retornava 500 com:

```
PrismaClientKnownRequestError
The table `public.Instance` does not exist in the current database.
code: 'P2021'
```

**Fix:** criar DB dedicada `evolution_db` + apontar URI para ela. Evolution roda `prisma migrate deploy` no startup automático. Persistido em `docker-stack.yml`.

### 2.2 Hetzner IPv6 flag-listed (não resolvido)

Após a DB ser corrigida, o Evolution conseguia criar instância (`POST /instance/create` → 201 com `instanceId`), mas o QR Code nunca era emitido. Investigação levou à descoberta acima.

---

## 3. Imagem custom (`vsaas-evolution/Dockerfile`)

Foi criada uma imagem custom (`icv_evolution:baileys-patched`) que sobrepõe o `node_modules/baileys` pelo HEAD do fork `EvolutionAPI/Baileys`. **Hoje ela não destrava o QR** (causa é IP, não Baileys), mas fica pronta para o dia que upstream lance um workaround.

```bash
# Build
docker build -t icv_evolution:baileys-patched -f vsaas-evolution/Dockerfile vsaas-evolution/

# Deploy
docker service update --image icv_evolution:baileys-patched --force iacloud_evolution

# Rollback para imagem oficial
docker service update --image atendai/evolution-api:v2.2.3 --force iacloud_evolution
```

---

## 4. Como configurar Twilio (recomendado para super-admin agora)

1. Criar conta Twilio + ativar sandbox WhatsApp ou comprar número Business
2. No painel: **Settings → Notificações → WhatsApp**
3. Toggle "WhatsApp Business" ativado
4. Provider: **Twilio**
5. Account SID: `ACxxxxxxxxxx` (de console.twilio.com)
6. Auth Token: `xxxxxxxx`
7. Número remetente: `+5511999999999` (E.164)
8. Salvar
9. Aba "Destinatários" → adicionar números → testar com botão "Enviar mensagem de teste"

Custo: ~US$ 0,005 por mensagem enviada (template aprovado) ou US$ 0,0085 por sessão de 24h iniciada por usuário.

---

## 5. Como configurar Meta Cloud API (recomendado se quer free tier)

1. Criar app no Meta Developer Portal
2. Adicionar produto "WhatsApp"
3. Pegar `phone_number_id` e `permanent_token` (System User)
4. No painel: **Settings → Notificações → WhatsApp**
5. Provider: **Meta Cloud API**
6. Business Account ID: `phone_number_id`
7. Access Token: `permanent_token`
8. Salvar e testar

Free tier: 1.000 conversas/mês iniciadas pelo usuário (gratuitas) + templates aprovados.

---

## 6. Comandos úteis

```bash
# Ver estado do canal singleton (super-admin)
docker exec $(docker ps -q -f name=iacloud_postgres) psql -U icvuser -d iacloudvision \
  -c 'SELECT id, "instanceName", "connectionState", "phoneNumber" FROM "SystemNotificationChannel";'

# Ver instâncias na Evolution
docker exec $(docker ps -q -f name=iacloud_evolution) wget -qO- \
  --header="apikey: icv_evolution_secret" http://localhost:8080/instance/fetchInstances

# Logs verbose temporários
docker service update \
  --env-add 'LOG_LEVEL=ERROR,WARN,INFO,LOG,VERBOSE,DEBUG' \
  --env-add 'LOG_BAILEYS=info' \
  --update-order stop-first --force iacloud_evolution

# Rollback verbose
docker service update --env-rm 'LOG_LEVEL' --env-add 'LOG_LEVEL=ERROR' \
  --env-rm 'LOG_BAILEYS' --env-add 'LOG_BAILEYS=error' \
  --update-order stop-first --force iacloud_evolution

# Reset estado completo do Evolution (instâncias + volume)
docker exec $(docker ps -q -f name=iacloud_postgres) psql -U icvuser -d evolution_db \
  -c 'TRUNCATE TABLE "Instance" CASCADE;'
docker run --rm -v iacloud_evolution_instances:/inst alpine sh -c 'rm -rf /inst/*'
docker service update --update-order stop-first --force iacloud_evolution
```

---

## 7. Próximos passos sugeridos

| # | Ação | Esforço | Resolve? |
|---|---|---|---|
| 1 | Configurar Twilio para super-admin (alertas comerciais + sistema P0) | 1 hora | ✅ imediato |
| 2 | Configurar Meta Cloud API como fallback (free tier) | 2 horas | ✅ imediato |
| 3 | Comprar proxy residencial e plugar PROXY_HOST no Evolution | 1 dia + ~US$50/mês | ✅ destrava Baileys |
| 4 | Migrar Evolution para VPS com IP residencial | 1 semana | 🟡 efêmero (IP pode ser flag depois) |
| 5 | Acompanhar updates do EvolutionAPI/Baileys que mitiguem bloqueio | aguardar | 🟡 sem ETA |
