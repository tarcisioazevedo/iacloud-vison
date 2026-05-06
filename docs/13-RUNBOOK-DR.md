# Runbook — Disaster Recovery (DR)

> **FCB-017** — bloqueador absoluto v1 piloto definitiva.
> Sem DR testado, backup é teoria.
>
> **Use este runbook quando:** PostgreSQL caiu, VPS Hetzner perdida, R2 inacessível,
> ou Cloudflare down. Cada cenário tem RTO (tempo até voltar) e RPO (dados que
> aceita perder).

## Ferramentas disponíveis

| Script | O que faz |
|---|---|
| `scripts/backup-postgres.sh` | Cria dump local diário (cron 03:00 — retém 7) |
| `scripts/backup-postgres-r2.sh` | Sobe último dump local pro R2 (cron 03:30 — retém 30 dias) |
| `scripts/restore-postgres.sh` | Restaura local ou R2 em DB test ou prod |

**Pré-requisito comum a todos os cenários:**
- Backup R2 ativo (4 passos do header de `scripts/backup-postgres-r2.sh`)
- Cron rodando: `crontab -l | grep backup-postgres`
- Mensal: `restore-postgres.sh --target test --dry-run` (validação sem destruir prod)

---

## Cenário 1 — PostgreSQL corrompido / perdeu container

**Sintomas:**
- Backend retorna 500 em todos os endpoints
- `docker service logs iacloud_backend` mostra `connection refused` ou `relation X does not exist`
- `docker exec icv_postgres psql -U icvuser` falha com erro `database does not exist`

**RTO:** ~5-15 min (depende tamanho do dump)
**RPO:** até 24 h (último backup diário)

### Passo a passo

```bash
# 1. PARAR backend (evita escritas em DB inconsistente)
docker service scale iacloud_backend=0

# 2. Validar última fonte de backup boa
ls -lh /opt/iacloud-vison/backups/ | tail -5
# Esperado: arquivo iacloudvision_<TS>.sql.gz menor que 24h

# 3. Se backup local OK, restaura direto
sudo /opt/iacloud-vison/scripts/restore-postgres.sh --target prod
# Vai pedir 2x confirmação ("RESTAURAR PROD" + nome do DB)

# 4. Se local corrompido também, restaura do R2:
sudo /opt/iacloud-vison/scripts/restore-postgres.sh --from-r2 $(date -d 'yesterday' +%Y-%m-%d) --target prod

# 5. Smoke checks
docker exec icv_postgres psql -U icvuser iacloudvision -c 'SELECT count(*) FROM "EdgeNode";'
# Esperado: número > 0

# 6. Subir backend
docker service scale iacloud_backend=1
sleep 30
curl -s https://app.iacloud.com.br/api/health | jq

# 7. Validar Box conecta
# Ver no painel /admin/tenants/:id?tab=logs se heartbeat de Box em prod chega em 60s
```

**Backup defensivo automático:** o `restore-postgres.sh --target prod` faz dump do estado atual ANTES de restaurar, em `/opt/iacloud-vison/backups/PRE_RESTORE_<TS>.sql.gz`. Se restore der errado, restore esse defense backup.

---

## Cenário 2 — VPS Hetzner perdida (hardware ou conta suspensa)

**Sintomas:**
- `app.iacloud.com.br` retorna 522/523/524 do Cloudflare
- SSH na VPS recusa conexão
- Painel Hetzner mostra status crítico ou conta bloqueada

**RTO:** ~2-4 h (provisionar nova VPS + restore + DNS)
**RPO:** até 24 h

### Passo a passo

```bash
# 1. Provisionar nova VPS Hetzner
#    - Mesmo plano: CX22 ou superior (4 CPU, 8 GB)
#    - Imagem: Ubuntu 24.04 LTS
#    - Local: Falkenstein (mantém latência)
#    - Anotar IPv4 NOVO

NEW_IP=23.88.x.y  # do dashboard Hetzner

# 2. Setup base (executar de outro lugar SSH)
ssh root@$NEW_IP <<'BOOTSTRAP'
apt update && apt install -y docker.io docker-compose-plugin caddy git awscli
systemctl enable --now docker

# Criar user claude (não rodar como root)
useradd -m -s /bin/bash claude
usermod -aG docker claude
mkdir -p /opt/iacloud-vison
chown claude:claude /opt/iacloud-vison
BOOTSTRAP

# 3. Restaurar repo + secrets
ssh claude@$NEW_IP <<'REPO'
cd /opt
git clone git@github.com:tarcisioazevedo/iacloud-vison.git
# OU restaurar do snapshot mais recente: scp /tmp/iacloud-snapshot-*.tar.gz claude@$NEW_IP:/tmp/ && tar -xzf
REPO

# 4. Recuperar secrets (manual — não estão em git)
#    Conferir lista em CLAUDE.md "9 credenciais de produção"
#    PostgreSQL password, ICV_ENCRYPTION_KEY, R2 keys, VAPID, Evolution, SMTP
#    Origem: cofre pessoal (1Password / Bitwarden / vault.json local)

# 5. Subir stack
ssh claude@$NEW_IP <<'DEPLOY'
cd /opt/iacloud-vison
docker swarm init --advertise-addr <NEW_IP>
docker stack deploy -c docker-stack.yml iacloud
DEPLOY

# 6. Restore PostgreSQL do R2 (último backup)
ssh root@$NEW_IP "/opt/iacloud-vison/scripts/restore-postgres.sh --from-r2 $(date -d 'yesterday' +%Y-%m-%d) --target prod"

# 7. Atualizar DNS Cloudflare apontando pro IP NOVO
#    Manual: Cloudflare dashboard → A record (app, evolution, box) → editar IP → save
#    Propagação: ~1 min (Cloudflare é rápido, não esperar TTL)

# 8. Caddy reaplica certs Let's Encrypt
ssh root@$NEW_IP "systemctl reload caddy && journalctl -u caddy -f"
# Aguardar "certificate obtained successfully" para os 3 domínios

# 9. Smoke E2E
curl -I https://app.iacloud.com.br/health
# Esperado: HTTP/2 200
```

**Atenção tunnels Box:** Boxes em campo apontam pra `tn-<edge>.iacloud.com.br`.
Esses subdomínios são **gerenciados pela Cloud via Cloudflare API** quando Box ativa.
Se Cloud sobe novamente com mesmo `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`,
os tunnels existentes **continuam válidos** — Box só precisa reativar.

---

## Cenário 3 — R2 inacessível (Cloudflare R2 down ou credenciais revogadas)

**Sintomas:**
- Uploads de evidência falham com 403/500
- Box mostra erros "vault upload failed" no log
- Painel admin mostra `vault_quota` indefinido

**RTO:** ~30 min (modo degradado) ou aguardar Cloudflare voltar
**RPO:** zero (eventos continuam no DB local; só evidências de mídia perdem)

### Modo degradado

```bash
# 1. Cloud aceita eventos sem snapshot R2
# (já é o comportamento — vaultKey é opcional em AnalyticsEvent)
# Cliente vê evento no painel, sem thumbnail/clip por enquanto

# 2. Box continua acumulando vault uploads na queue local
# (sync_queue + LRU cap 20k itens — não estoura disco)

# 3. Quando R2 voltar, drain automático
# Box detecta retorno → drena queue (FIFO) → uploads retomam
```

**Se credenciais R2 foram revogadas:**

```bash
# 1. Gerar novas API tokens R2 no dashboard Cloudflare
# 2. Atualizar secrets:
nano /opt/iacloud-vison/secrets/r2.env
# R2_ACCESS_KEY_ID=NEW
# R2_SECRET_ACCESS_KEY=NEW

# 3. Reload backend
docker service update --force iacloud_backend

# 4. Box re-ativa para pegar novas credentials escopadas
# (FCB-006 vault renewal já automatiza isso quando expiresAt < 24h)
```

---

## Cenário 4 — Cloudflare down (DNS, CDN ou proxy)

**Sintomas:**
- DNS não resolve qualquer `*.iacloud.com.br`
- Twitter cheio de "Cloudflare está down" 🙃

**RTO:** depende da Cloudflare (histórico: ~2 h em incidentes graves)
**RPO:** zero

### Mitigação imediata

Cloudflare resolve DNS — sem ele, ninguém chega na VPS via domínio. **Mas se DNS está
desligado mas o IP da VPS continua vivo**, dá pra cliente acessar via IP direto:

```bash
# Comunicar fallback aos integradores piloto (whatsapp/email):
#   "Cloudflare está com instabilidade. Acesso temporário pelo IP:
#    https://23.88.124.67 (aceita o certificado warning)"
```

**Sem ação Cloud-side possível além de comunicar.** Se acontecer com frequência,
considerar segundo provedor DNS (Route 53 secundário) — fica para Sprint 2 (FCB-014
Health Score por Box e fleet).

---

## Teste mensal (cron)

```bash
# Adicionar em crontab do root:
# Dia 1 do mês, 04:00 — testa restore em DB temporário
0 4 1 * * /opt/iacloud-vison/scripts/restore-postgres.sh --target test --dry-run >> /var/log/icv-dr-test.log 2>&1
```

Resultado esperado:
- Sucesso: log com "Backup válido. Sem restauração."
- Falha: e-mail crítico ao DPO + Tarcísio (configurar Sentry alert ou cron-mail)

---

## Critérios de aceite FCB-017

- [ ] `scripts/restore-postgres.sh` existe e tem flag `--help`
- [ ] `docs/13-RUNBOOK-DR.md` documenta 4 cenários (este arquivo)
- [ ] Cron mensal de teste configurado em `crontab -l`
- [ ] Pelo menos **1 teste real** executado com sucesso (registrar em `docs/PRE-HOMOLOGACAO-CHECKLIST.md`)
- [ ] Restore script smoke testado: `--target test --dry-run` retorna 0

---

## RTO/RPO consolidados

| Cenário | RTO | RPO |
|---|---|---|
| 1 — PostgreSQL corrompido | 5-15 min | 24 h |
| 2 — VPS perdida | 2-4 h | 24 h |
| 3 — R2 down (modo degradado) | 30 min | zero |
| 3 — R2 credenciais revogadas | 30 min | zero |
| 4 — Cloudflare down | depende deles | zero |

---

**Última revisão:** 2026-05-06
**Próxima revisão obrigatória:** após primeiro restore real em produção (qualquer cenário acima)
