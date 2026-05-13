# Plano de Rename Total — IA Cloud Vision → VSaaS

**Status:** 📋 Plano consolidado · execução por fases
**Owner:** Tarcísio + Claude
**Criado:** 2026-05-12

---

## Estado real (auditado em 2026-05-12)

Áudito completo do que **falta** pro rename 100%:

| Categoria | Ocorrências/itens | Risco | Pode eu fazer? |
|---|---|---|---|
| Strings UI + comentários — backend | 44 arquivos | 🟢 baixo | ✅ |
| Strings UI + comentários — frontend | 67 arquivos | 🟢 baixo | ✅ |
| Documentação `.md` | 41 arquivos | 🟢 baixo | ✅ |
| `process.env.ICV_*` (10 vars de env) | 10 nomes | 🟡 médio | ✅ (mantendo compat) |
| localStorage keys (`icv_*`, `icv:*`) | ~10 keys | 🔴 alto | ⚠️ quebra sessões |
| Email visível ao cliente (SMTP_FROM, push subject) | 3 lugares | 🟢 baixo | ✅ |
| Caixas de e-mail reais (`iacloudvision@iacloud.com.br` etc) | 5 caixas | 🔴 alto | ❌ requer acesso a provedor |
| Service names Docker (`iacloud_*`) | 9 serviços | 🔴 alto | ⚠️ requer downtime (~3min) |
| Image names (`icv_backend`, `icv_frontend`) | 2 imagens | 🟡 médio | ✅ |
| DB name (`iacloudvision`) + user (`icvuser`) | base inteira | 🔴 alto | ⚠️ requer dump+restore (~10min downtime) |
| Domínio (`iacloud.com.br`) | Caddy + DNS | 🔴 alto | ❌ requer registrar `vsaas.com.br` |
| R2 bucket prefix (`icv-*`) | todos os clientes | 🔴 alto | ❌ requer copy R2→R2 (caro, GB-out) |
| GitHub repo (`iacloud-vison`) | 1 repo | 🟡 médio | ❌ requer ação no GitHub UI |
| Diretório `/opt/iacloud-vison/` | filesystem da VPS | 🟡 médio | ⚠️ pode quebrar paths |
| Sentry org slug | 1 config | 🟢 baixo | ❌ requer Sentry UI |
| Git history (commits, blame) | ~200 commits | 🔴 alto | ⚠️ filter-repo destrutivo |

---

## Fases de execução

### 🟢 Fase 1 — Limpeza de strings (não-destrutivo, executando AGORA)

- [ ] Backend src/: replace de `IA Cloud Vision` em comments e strings de log
- [ ] Frontend src/: replace residual (algumas pages secundárias)
- [ ] `SMTP_FROM: "VSaaS <noreply@vsaas.com.br>"` (visível em todos e-mails)
- [ ] Email body templates (notify.service.ts, sales/etc)
- [ ] WhatsApp templates (channels.ts, notifications.ts)
- [ ] Docs `.md` que ainda tenham strings antigas (preservando histórico)

**Risco:** zero. Só strings de display.
**Estimativa:** ~30min.

### 🟡 Fase 2 — Identidade técnica local (env, CSS) — DEFERIDO

Aliases compatíveis em vez de rename direto:
- Backend: `process.env.VSAAS_ENCRYPTION_KEY ?? process.env.ICV_ENCRYPTION_KEY` (lê ambos, prefere nova)
- Frontend: migração de `localStorage.icv_token` → `localStorage.vsaas_token` com migration helper no boot
- CSS vars: alias `--vsaas-*` → `--icv-*`

**Por que deferir:** localStorage rename invalida sessão de TODOS os usuários. Antes do piloto, vale fazer junto com a rotação P0 do JWT (que também invalida sessão).

**Estimativa quando for hora:** ~3h.

### 🔴 Fase 3 — Infra Docker (requer downtime) — DEFERIDO

Renomear stack `iacloud` → `vsaas` significa:
1. `docker stack rm iacloud` (mata tudo)
2. Editar `docker-stack.yml`: substituir `iacloud_*` por `vsaas_*` em service names, secret names externos (`iacloud_cloudflare_*`), volumes
3. Recriar secrets: `docker secret create vsaas_cloudflare_api_token ...`
4. `docker stack deploy -c docker-stack.yml vsaas`
5. Reescrever scripts (`backup-postgres.sh` filtra por nome do container)
6. Atualizar Caddy upstream (apontar pro novo nome)

**Tempo total:** ~5min de downtime + 1h de prep.
**Quando fazer:** janela de manutenção dedicada.

### 🔴 Fase 4 — Database rename — DEFERIDO

`iacloudvision` → `vsaas_db`, user `icvuser` → `vsaas_user`:
```bash
# 1. Backup
/opt/iacloud-vison/scripts/backup-postgres.sh

# 2. Dump completo
docker exec postgres pg_dumpall -U icvuser > full.sql

# 3. Restore com nomes novos (script faz find-replace no dump SQL)
sed -i 's/iacloudvision/vsaas_db/g; s/icvuser/vsaas_user/g' full.sql

# 4. Recriar:
DROP DATABASE iacloudvision; CREATE DATABASE vsaas_db OWNER vsaas_user;
psql -U vsaas_user < full.sql

# 5. Atualizar DATABASE_URL no template (docker-stack.yml + secrets-bootstrap)

# 6. Redeploy backend
```

**Risco:** se algo falhar, restaurar do dump. Backup mandatório.
**Tempo:** 15-20min de downtime.
**Quando fazer:** junto da Fase 3.

### 🔴 Fase 5 — Externo (precisa Tarcísio operar) — BLOQUEADO HUMANO

1. **Domínio**: registrar `vsaas.com.br` (Registro.br, ~R$40/ano)
2. **Cloudflare**: novo zone + CNAMEs + Custom Hostnames apontados pra Caddy
3. **DNS**: `app.vsaas.com.br`, `evolution.vsaas.com.br`, etc
4. **SSL**: Caddy re-emite Let's Encrypt no novo domínio (automático)
5. **E-mails**: novo MX no provedor + caixas (`noreply@`, `suporte@`, `dpo@`, etc)
6. **R2 buckets**: criar prefixo `vsaas-*` e migrar arquivos (rclone copy — custa egress)
7. **Sentry**: criar nova org `vsaas` + atualizar DSN no frontend
8. **GitHub**: renomear repo `iacloud-vison` → `vsaas-platform` (UI do GitHub)

**Bloqueado:** eu não posso acessar nenhum desses sistemas.
**Plano:** quando você quiser fazer, eu te guio passo-a-passo e atualizo os configs no código.

### 🔴 Fase 6 — Filesystem rename (`/opt/iacloud-vison/` → `/opt/vsaas/`) — DEFERIDO

Implica:
- Parar serviços
- `mv /opt/iacloud-vison /opt/vsaas`
- Atualizar **TODOS** os bind mounts no `docker-stack.yml` (~15 paths)
- Atualizar cron de backup (`scripts/backup-postgres.sh`)
- Atualizar git hooks
- Atualizar `core.hooksPath`
- Reativar tudo

**Tempo:** ~30min com checklist.
**Quando fazer:** junto da Fase 3 ou depois.

### 🔴 Fase 7 — Git history rewrite — DEFERIDO

`git filter-repo` pra reescrever commits substituindo strings em arquivos antigos. Destrutivo, perde hashes, exige force-push e re-clone por todos collaborators (você é solo, mas mesmo assim).

**Quando fazer:** junto da rotação P0 de credenciais (já requer filter-repo pra apagar `docker-stack.yml` antigo).

---

## Ordem recomendada

1. **Hoje (~30min):** Fase 1 — strings UI
2. **Janela próxima (~4h):** Fases 3 + 4 + 6 juntas em single downtime window
3. **Quando tiver domínio novo:** Fase 5
4. **Junto da rotação P0:** Fases 2 + 7

---

## O que ENTREGUE até agora (já em produção)

- ✅ Brand assets: logomark + wordmark VSaaS em `/brand/`
- ✅ index.html: title, meta, favicon, manifest VSaaS
- ✅ LoginPage: gradient navy, hero VSaaS, sem duplicação de marca
- ✅ Sidebar: VSaaS wordmark, always-dark, retrátil
- ✅ AdminDashboardPage: hero "Visão geral — comando do fabricante", KPI direct cams
- ✅ ClienteCockpitPage: refatorado sem overlay duplicado
- ✅ Tabela Integradores: coluna CÂMERAS com split EDGE vs DIRECT
- ✅ ~51 strings "IA Cloud Vision" → "VSaaS" em 25 arquivos
- ✅ "IA Cloud Vision LTDA" → "VSaaS LTDA" (legal references)
