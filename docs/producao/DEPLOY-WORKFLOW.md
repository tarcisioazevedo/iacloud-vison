# Guia: Deploy Workflow IACV

Este documento ensina **como configurar e usar** o pipeline de deploy
automatizado (`.github/workflows/deploy.yml`).

> Pré-leitura: PDF `IACV-Plano-Producao.pdf`, capítulos 5, 7, 8.

---

## 1. Visão geral do pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  push em dev          tag v*.*.*           workflow_dispatch        │
│      │                    │                     │                   │
│      ▼                    │                     │                   │
│  build-cloud.yml          │                     │                   │
│      │                    │                     │                   │
│      ▼                    ▼                     ▼                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    deploy.yml                                 │  │
│  │                                                               │  │
│  │  resolve-tag                                                  │  │
│  │      │                                                        │  │
│  │      ├──────────────────┐                                    │  │
│  │      ▼                  ▼                                    │  │
│  │  staging          prod-canary  (gate: 1 reviewer)            │  │
│  │  (automático)         │                                      │  │
│  │                       ▼                                      │  │
│  │                  prod-batch    (gate: 2 reviewers)           │  │
│  │                       │                                      │  │
│  │                       ▼                                      │  │
│  │                  prod-full     (gate: 2 reviewers)           │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Tempo total:** ~1.5 hora se aprovações forem rápidas, até 6 horas
respeitando janelas de observação recomendadas.

---

## 2. Configuração inicial (one-time)

Faça **uma única vez** quando configurar o repositório.

### 2.1 — Servidores e usuários

#### Staging (1 VPS)

```bash
# Como root, no servidor de staging
adduser deploy
usermod -aG docker deploy

# SSH key separada para deploy automatizado
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/id_ed25519 -N ""

# Diretórios
mkdir -p /opt/iacv/scripts /backups/predeploy /etc/iacv
chown -R deploy:deploy /opt/iacv /backups/predeploy
chmod 750 /etc/iacv
```

#### Produção (1 VPS, ou cluster Swarm)

Mesmo procedimento, apenas com hosts e chaves diferentes.

### 2.2 — Configurar lista de tenants

No host de **produção** (e replicar em staging com lista diferente):

```bash
sudo tee /etc/iacv/tenants.conf <<'EOF'
# CANARY: tenants internos/demo. Sempre os primeiros a receber update.
CANARY_TENANTS=("demo" "interno")

# BATCH: ~10% dos clientes, escolha os mais estáveis e tolerantes.
BATCH_TENANTS=("cliente_a" "cliente_b" "cliente_c")

# Os demais são tratados como "remaining" automaticamente.
EOF
sudo chown deploy:deploy /etc/iacv/tenants.conf
sudo chmod 644 /etc/iacv/tenants.conf
```

### 2.3 — Secrets do repositório (GitHub)

Em **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor | Onde |
|---|---|---|
| `STAGING_HOST` | `staging.iacv.example.com` | Repository |
| `STAGING_USER` | `deploy` | Repository |
| `STAGING_SSH_KEY` | conteúdo de `~/.ssh/id_ed25519` (privada) | Repository |
| `STAGING_AUTH_USER` | `admin` (usuário API) | Repository |
| `STAGING_AUTH_PASS` | senha do admin | Repository |
| `PROD_HOST` | `prod.iacv.example.com` | **Environment** |
| `PROD_USER` | `deploy` | **Environment** |
| `PROD_SSH_KEY` | chave privada SSH do prod | **Environment** |
| `PROD_AUTH_USER` | `admin` | **Environment** |
| `PROD_AUTH_PASS` | senha do admin de prod | **Environment** |
| `SLACK_WEBHOOK` | URL do webhook do Slack | Repository |

> Os secrets de **produção** vão dentro dos *Environments* (próximo passo)
> — isso impede que jobs sem aprovação acessem credenciais de prod.

### 2.4 — Adicionar SSH público ao authorized_keys

Pegue a chave **pública** gerada no host (ex: `cat ~/.ssh/id_ed25519.pub`)
e adicione em `~deploy/.ssh/authorized_keys` do servidor correspondente.

> Quem **gera** a chave SSH é uma escolha:
> - Opção A (recomendada): gere localmente em uma máquina admin, copie a
>   pública para o host e a privada para o GitHub Secret.
> - Opção B: gere no host, copie a privada para o GitHub Secret e
>   **delete do host**.

### 2.5 — Configurar GitHub Environments

Em **Settings → Environments → New environment**, criar 4 ambientes:

#### `staging`
- **Required reviewers:** ❌ nenhum (deploy automático)
- **Wait timer:** 0 minutos
- **Deployment branches:** `dev` apenas
- **Secrets:** (nenhum extra — usa os do repo)

#### `production-canary`
- **Required reviewers:** ✅ 1 (você ou outro lead)
- **Wait timer:** 0 minutos
- **Deployment branches:** `main` apenas (com tags `v*`)
- **Secrets:** `PROD_HOST`, `PROD_USER`, `PROD_SSH_KEY`, `PROD_AUTH_USER`, `PROD_AUTH_PASS`

#### `production-batch`
- **Required reviewers:** ✅ 2 (você + outro)
- **Wait timer:** 60 minutos *(força observação do canário)*
- **Deployment branches:** `main`
- **Secrets:** mesmos do canário

#### `production-full`
- **Required reviewers:** ✅ 2
- **Wait timer:** 240 minutos *(força observação do batch)*
- **Deployment branches:** `main`
- **Secrets:** mesmos do canário

> **Wait timer** é a chave da segurança: o GitHub espera os minutos
> definidos antes de até apresentar o botão "Approve and deploy". Isso
> impede que alguém aprove batch logo após canário sem observar métricas.

### 2.6 — Testar conectividade SSH

Antes de qualquer deploy, valide manualmente:

```bash
# Da sua máquina de admin (ou de um runner GitHub, dispatch manual)
ssh -i ~/.ssh/id_ed25519_iacv_staging deploy@staging.iacv.example.com 'docker ps | head -3'
ssh -i ~/.ssh/id_ed25519_iacv_prod deploy@prod.iacv.example.com 'docker stack ls | head -3'
```

Se não conectar, confirme:
- `authorized_keys` no host
- Firewall liberando 22 (ou porta customizada)
- `sshd_config` permite `PubkeyAuthentication yes`

---

## 3. Fluxos de uso

### 3.1 — Fluxo padrão: deploy de uma feature

```
1. Você abre PR de feature/X → dev
2. CI valida e aprova merge
3. Merge em dev
4. build-cloud.yml builda imagem :dev-{sha}
5. deploy.yml dispara automaticamente:
   → deploy-staging (sem gate, vai direto)
6. Você acompanha o staging por 1h+
7. Se OK, abre PR dev → main, merge, cria tag v1.2.0
8. release.yml retageia para :v1.2.0
9. deploy.yml dispara:
   → deploy-prod-canary (gate: você aprova)
   ↓ 1h de observação (wait timer)
   → deploy-prod-batch (gate: 2 aprovam)
   ↓ 4h de observação
   → deploy-prod-full (gate: 2 aprovam)
10. Notificação no Slack: release completa
```

**Tempo total:** ~6 horas (com janelas de observação completas).

### 3.2 — Fluxo de hotfix (urgência)

```
1. Você cria branch hotfix/v1.2.4-fix-X de main
2. Fix mínimo + teste regression
3. PR → main com label "hotfix"
4. 2 reviewers aprovam rápido
5. Merge + tag v1.2.4 + push
6. release.yml builda :v1.2.4
7. deploy.yml dispara, MAS:
   - Você pode REDUZIR o wait timer dos environments
     temporariamente (Settings → Environments → wait_timer)
   - Ou ir aprovando manualmente respeitando o timer mínimo
8. Em ~30 min: deploy completo
```

> **Não desligue os gates de aprovação em hotfix.** Reduza o wait_timer
> de 60→15 min se necessário, mas mantenha as aprovações.

### 3.3 — Fluxo manual: re-deploy de uma versão

Cenário: você quer forçar redeploy de `v1.2.3` em um único tenant.

```
1. Vá em Actions → Deploy → Run workflow
2. Selecione branch (main)
3. target = "prod-canary" (ou outro)
4. image_tag = "v1.2.3"
5. Run workflow
6. Aprove os gates conforme aparecerem
```

### 3.4 — Fluxo de rollback

**Caso A — Rollback simples** (sem mexer no DB):

```bash
# SSH no host
ssh deploy@prod.iacv.example.com

# Para tenants afetados
TENANT_FILTER=cliente_x \
bash /opt/iacv/scripts/rollback.sh

# Ou para todos
TENANT_FILTER=all \
bash /opt/iacv/scripts/rollback.sh
```

**Caso B — Forçar uma versão específica:**

```bash
TARGET_VERSION=v1.2.2 \
TENANT_FILTER=all \
bash /opt/iacv/scripts/rollback.sh
```

**Caso C — Rollback com restore de DB:** ver Runbook 02 no PDF.

---

## 4. Acompanhar um deploy em andamento

### 4.1 — Pelo GitHub

1. Vá em **Actions** → workflow **Deploy**
2. Clique no run em andamento
3. Cada job mostra logs em tempo real
4. Quando um gate aparecer, você verá um botão amarelo:
   **"Review deployments"** → escolha "Approve and deploy" ou "Reject"

### 4.2 — Pelo terminal (host)

```bash
# Ver versão atual em todos os tenants
ssh deploy@prod.iacv.example.com 'EXPECTED_VERSION=v1.2.3 bash /opt/iacv/scripts/verify-versions.sh'

# Logs em tempo real de um tenant durante deploy
ssh deploy@prod.iacv.example.com 'docker service logs -f --since 5m vision-cliente_x_vision'

# Status do update
ssh deploy@prod.iacv.example.com 'docker service ps vision-cliente_x_vision'
```

### 4.3 — Pelo Grafana

Painel `iacv` deve ter:
- Taxa de erro 5xx (alerta se >1%)
- Latência p95 (alerta se >2x baseline)
- Versão por tenant (histograma)
- CPU/RAM por tenant

URL recomendada: `https://grafana.iacv.example.com/d/iacv?refresh=5s`

---

## 5. Troubleshooting

### "Build não passou. Abortando."

O `deploy.yml` só dispara se o `build-cloud.yml` passou. Se o build
falhou, conserte primeiro.

```bash
# Ver logs do último build
gh run list --workflow=build-cloud.yml --limit 5
gh run view <run-id>
```

### "Permission denied (publickey)"

```bash
# Validar localmente
ssh -i /caminho/da/chave deploy@host

# No host, ver se a chave pública está em authorized_keys
ssh deploy@host 'cat ~/.ssh/authorized_keys'

# No GitHub, conferir que o secret SSH_KEY tem a chave PRIVADA inteira
# (incluindo as linhas BEGIN/END)
```

### "no tenant for filter 'canary'"

Você esqueceu de criar `/etc/iacv/tenants.conf` no host. Ver passo 2.2.

### Smoke test falhou em "Snapshot é JPEG"

Provavelmente o nome `CAMERA_TEST` está errado. Configure:

```yaml
# No deploy.yml, na step "Smoke tests"
env:
  CAMERA_TEST: nome_real_de_uma_camera_de_teste
```

### Deploy travado em "Review deployments"

Alguém precisa aprovar. Vá em Actions → Run em andamento →
"Review pending deployments".

Se ninguém pode aprovar, o run expira em **1 dia** (configurável em
Repository settings).

### Job de deploy passou mas tenants não atualizaram

```bash
# Verificar versão real
ssh deploy@prod 'EXPECTED_VERSION=v1.2.3 bash /opt/iacv/scripts/verify-versions.sh'

# Se algum estiver errado, forçar update manual
ssh deploy@prod
TENANT_FILTER=cliente_x IMAGE_TAG=v1.2.3 bash /opt/iacv/scripts/swarm-update.sh
```

### Auto-rollback do Swarm não acionou

Pode ser que o healthcheck do compose não esteja configurado. Verificar:

```bash
docker service inspect vision-cliente_x_vision \
  --format '{{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}}'
```

Se retornar `null`, adicione no `docker-compose.cloud.yml`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8971/version"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 60s
```

E faça redeploy do stack (não basta `service update`).

---

## 6. Manutenção do pipeline

### Adicionar um tenant novo

```bash
# 1. Provisionar stack do tenant (compose habitual)
TENANT_SLUG=novo_cliente \
docker stack deploy -c docker-compose.cloud.yml vision-novo_cliente

# 2. Decidir categoria (não precisa editar tenants.conf se for "remaining")
# 3. Pronto — próximo deploy já o inclui automaticamente
```

### Remover um tenant

```bash
# 1. Backup final (compliance)
TENANT_FILTER=novo_cliente bash /opt/iacv/scripts/pre-deploy-backup.sh

# 2. Derrubar stack
docker stack rm vision-novo_cliente

# 3. Apagar volumes (CUIDADO — irreversível)
# docker volume rm vision-novo_cliente_config vision-novo_cliente_media
```

### Mudar lista de canário/batch

Edite `/etc/iacv/tenants.conf` no host. Não requer commit no repo.

```bash
sudo nano /etc/iacv/tenants.conf
# salvar e sair — próximo deploy já usa a nova lista
```

### Atualizar os scripts deploy/

Os scripts são versionados no repo e copiados para o host pelo `deploy.yml`
via rsync. Para atualizar:

1. Edite arquivos em `scripts/deploy/`
2. PR + merge em dev
3. No próximo deploy, rsync os atualiza no host

### Pausar deploys (freeze de release)

```
Settings → Branches → main → "Lock branch"
```

Bloqueia novos merges em main, então não há novas tags, então não há
deploys. Útil em fim de semana / vésperas de feriado.

---

## 7. Checklist de primeiro deploy

Use isso na primeira vez que rodar o pipeline:

- [ ] Hosts staging + prod provisionados (Docker Swarm + Traefik OK)
- [ ] Usuário `deploy` criado em ambos com grupo `docker`
- [ ] Diretórios `/opt/iacv`, `/backups/predeploy`, `/etc/iacv` criados
- [ ] `/etc/iacv/tenants.conf` populado em prod
- [ ] Chaves SSH geradas e adicionadas em `authorized_keys`
- [ ] Conectividade SSH testada manualmente
- [ ] 11 secrets do repo configurados
- [ ] 4 environments criados com required reviewers + wait timers
- [ ] Pelo menos 1 tenant "canário" rodando em prod (`vision-demo_vision`)
- [ ] Healthcheck no `docker-compose.cloud.yml` (curl /version)
- [ ] Slack webhook testado (curl manual)
- [ ] Grafana com dashboard `iacv` importado
- [ ] Câmera de teste (`CAMERA_TEST`) acessível
- [ ] **Deploy de teste:** workflow_dispatch com `image_tag=latest target=staging`
- [ ] **Smoke tests passam** em staging
- [ ] **Rollback de teste:** rodar `rollback.sh` em staging e verificar versão volta

Se todos os ✅ passarem, você está pronto para liberar em produção.

---

## 8. Glossário rápido

| Termo | O que é |
|---|---|
| **Canário** | 1 tenant interno que recebe deploy primeiro, para detectar bugs cedo |
| **Batch** | ~10% dos tenants, segundo grupo a receber, antes do roll-out total |
| **Blue-green** | Estratégia onde versão nova sobe em paralelo à antiga e troca tráfego |
| **Rolling update** | Atualização incremental sem janela total de manutenção |
| **Wait timer** | Tempo mínimo que o GitHub espera antes de permitir aprovação |
| **Gate humano** | Passo onde uma pessoa precisa aprovar manualmente |
| **MTTR** | Mean Time To Recovery — quanto tempo leva pra voltar ao normal |
| **RTO** | Recovery Time Objective — tempo máximo aceitável fora do ar |
| **RPO** | Recovery Point Objective — perda máxima aceitável de dados |
