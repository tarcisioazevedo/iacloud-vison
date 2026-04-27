# 🚀 Comece aqui — Guia do zero ao primeiro deploy

Este documento é seu **roteiro linear**. Faça as fases na ordem.
Não pule. Cada fase tem um critério de "está pronto" — só vá para
a próxima quando ele estiver verde.

> Tempo total estimado: **2 a 4 dias** (não corridos — você pode parar
> em qualquer fase e retomar). A maior parte é configuração, não código.

---

## 📋 Pré-requisitos (antes da Fase 0)

Você precisa ter:

- [x] Conta no GitHub (já tem ✅)
- [x] Projeto local com git inicializado (já tem ✅)
- [x] Docker instalado na sua máquina (já tem ✅)
- [x] Git instalado (já tem ✅)
- [x] GitHub CLI (`gh`) instalado (instalado nesta sessão ✅)
- [ ] **Cartão de crédito** para contratar VPS (~R$ 150–500/mês total)
- [ ] **Domínio próprio** (ex: `iacv.com.br`) — Registro.br ~R$ 40/ano
- [ ] **2 horas livres** para a primeira fase
- [ ] Um Slack ou Discord (canal `#iacv-deploys`) — opcional mas útil

Se faltar **domínio** ou **cartão**, resolva antes de começar a Fase 4.
As 3 primeiras fases são gratuitas e só envolvem código + GitHub.

---

# FASE 0 — Inventário (15 min)

**Objetivo:** confirmar que sua máquina está pronta.

## 0.1 — Conferir versões

Abra o Git Bash (ou PowerShell) e rode:

```bash
git --version       # esperado: 2.x ou superior
docker --version    # esperado: 20.x ou superior
ssh -V              # esperado: OpenSSH 7.x ou superior
"/c/Program Files/GitHub CLI/gh.exe" --version  # esperado: 2.91.0
```

Se algum não responder, instale antes de prosseguir.

## 0.2 — Adicionar `gh` ao PATH (Windows)

Pra não ter que digitar o caminho completo toda vez:

```powershell
# PowerShell como administrador
[Environment]::SetEnvironmentVariable(
  "Path",
  $env:Path + ";C:\Program Files\GitHub CLI",
  "Machine"
)
```

Feche e reabra o terminal. Agora `gh --version` deve funcionar direto.

## 0.3 — Autenticar no GitHub

```bash
gh auth login
```

Responda assim:
- Where do you use GitHub? → **github.com**
- Preferred protocol? → **HTTPS**
- Authenticate Git with credentials? → **Yes**
- How? → **Login with a web browser**

Vai abrir o navegador, fazer login, autorizar. Depois:

```bash
gh auth status
```

Deve mostrar `✓ Logged in to github.com as tarcisioazevedo`.

## ✅ Critério de "fase 0 pronta"

```bash
gh auth status && echo "OK FASE 0"
```

Se imprimiu "OK FASE 0", siga para a Fase 1.

---

# FASE 1 — Subir o trabalho atual no GitHub (30 min)

**Objetivo:** consolidar tudo que criamos nesta sessão (deploy.yml,
scripts, docs) em commits limpos no GitHub.

## 1.1 — Confirmar branch atual

```bash
cd C:/Users/Master/Desktop/iacloudvision/iacloud-vison/.claude/worktrees/eloquent-jepsen-43bf7e
git status
git branch --show-current
```

Você está em `claude/eloquent-jepsen-43bf7e` (branch criada pelo Claude
para esta sessão). Tudo bem — vamos transformar essas mudanças em PR.

## 1.2 — Ver o que foi criado

```bash
git status --short
```

Deve mostrar arquivos não rastreados em:
- `.github/workflows/deploy.yml`
- `docs/producao/`
- `scripts/`

## 1.3 — Adicionar e commitar

```bash
git add .github/workflows/deploy.yml \
        docs/producao/ \
        scripts/

git commit -m "feat(prod): adicionar plano de produção, pipeline de deploy e runbooks

- docs/producao/IACV-Plano-Producao.pdf (43 páginas)
- docs/producao/DEPLOY-WORKFLOW.md (guia operacional)
- docs/producao/runbooks/ (4 procedimentos)
- docs/producao/diagramas/ (7 fluxos)
- .github/workflows/deploy.yml (4 estágios canário->batch->full)
- scripts/deploy/ (6 scripts shell para o host)"
```

## 1.4 — Enviar branch para o GitHub

```bash
git push -u origin claude/eloquent-jepsen-43bf7e
```

## 1.5 — Abrir Pull Request → dev

```bash
gh pr create \
  --base dev \
  --title "feat(prod): plano de produção + pipeline de deploy" \
  --body "Adiciona toda a documentação de produção, pipeline GitHub Actions e scripts de deploy. Detalhes em docs/producao/README.md"
```

Vai imprimir uma URL — abra no navegador, revise, e clique **Merge**.

## ✅ Critério de "fase 1 pronta"

```bash
git fetch origin
git log origin/dev --oneline -3
```

A primeira linha deve mencionar "feat(prod): plano de produção".

---

# FASE 2 — Estruturar branches e proteção (20 min)

**Objetivo:** criar `main` (que não existe ainda) e proteger as duas
branches principais.

## 2.1 — Criar branch `main` a partir de `dev`

`main` será o que está em produção. `dev` é integração contínua.
A primeira vez, elas começam iguais.

```bash
git fetch origin
git checkout dev
git pull --ff-only origin dev
git checkout -b main
git push -u origin main
```

## 2.2 — Configurar `main` como branch padrão no GitHub

```bash
gh api -X PATCH repos/tarcisioazevedo/iacloud-vison \
  -f default_branch=main
```

A partir daqui, novos clones do repo virão na `main`.

## 2.3 — Proteger `main`

```bash
gh api -X PUT repos/tarcisioazevedo/iacloud-vison/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["AMD64 Build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 2,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

> Se o comando reclamar de "AMD64 Build" não existir, é porque o CI
> nunca rodou em main. Tudo bem — comente essa linha agora e configure
> depois (Fase 3).

## 2.4 — Proteger `dev`

```bash
gh api -X PUT repos/tarcisioazevedo/iacloud-vison/branches/dev/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["AMD64 Build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

## ✅ Critério de "fase 2 pronta"

```bash
gh api repos/tarcisioazevedo/iacloud-vison/branches/main/protection \
  | grep -E '"required_approving_review_count"|"required_linear_history"'
```

Deve mostrar `"required_approving_review_count": 2`.

---

# FASE 3 — Validar CI rodando (15 min)

**Objetivo:** garantir que o `ci.yml` e `build-cloud.yml` existentes
funcionam, antes de tentar deploy.

## 3.1 — Acompanhar o build do PR que mergeamos na Fase 1

```bash
gh run list --limit 5
```

Deve listar runs recentes. Procure pelo workflow **"Build IA Cloud Vision"**.
Se falhou, abra para ver o motivo:

```bash
gh run view <run-id> --log-failed
```

Erros comuns nessa fase:
- **Faltando secret** → veja Fase 6
- **Out of disk** → re-rode o job, é flake
- **Dockerfile com bug** → conserta antes de seguir

## 3.2 — Se nunca rodou, dispare manualmente

```bash
gh workflow run "CI" --ref dev
gh workflow run "Build IA Cloud Vision" --ref dev
gh run watch
```

`gh run watch` mostra o progresso em tempo real.

## 3.3 — Verificar imagem no GHCR

Após o build passar:

```bash
gh api -H "Accept: application/vnd.github+json" \
  /users/tarcisioazevedo/packages/container/iacloud-vison/versions \
  | python -m json.tool | head -30
```

Se aparecer JSON com tags como `latest` e `<sha>`, o build publicou OK.

## ✅ Critério de "fase 3 pronta"

```bash
gh run list --workflow="Build IA Cloud Vision" --limit 1
```

Status deve ser **completed / success**.

---

# FASE 4 — Conseguir VPS de staging (1–2 horas)

**Objetivo:** ter um servidor Linux com Docker Swarm + Traefik
configurado para receber o primeiro deploy.

## 4.1 — Escolher provedor

Recomendações (Brasil 2026):

| Provedor | Plano | Preço/mês | Notas |
|---|---|---|---|
| **Hetzner CCX13** | 2 vCPU AMD, 8 GB, 80 GB | ~R$ 90 | Recomendado |
| **DigitalOcean** | 4 GB Premium | ~R$ 130 | Painel mais bonito |
| **Vultr** | 4 GB | ~R$ 110 | Boa rede no BR |
| **AWS Lightsail** | 4 GB | ~R$ 130 | Se já usa AWS |

Para staging, **2 vCPU e 4 GB de RAM** é suficiente. Você vai contratar
**1 VPS pequeno** agora. O de produção vem depois.

## 4.2 — Provisionar a VM

Crie a VM com:
- **OS:** Ubuntu 24.04 LTS
- **Região:** mais perto do seu público (São Paulo se BR)
- **Adicione sua chave SSH** (a do seu Windows local)

Para gerar uma chave SSH no Windows (se não tiver):

```bash
ssh-keygen -t ed25519 -C "tarcisio@iacv-admin" -f ~/.ssh/id_ed25519_iacv
cat ~/.ssh/id_ed25519_iacv.pub
```

Copie o conteúdo da `.pub` e cole no painel do provedor ao criar a VM.

## 4.3 — Apontar DNS

Tenha um domínio (ex: `iacv.com.br`). Crie estes registros A:

```
staging.iacv.com.br        → IP do VPS staging
*.staging.iacv.com.br      → IP do VPS staging   (wildcard)
```

> Wildcard é importante porque cada tenant fica em
> `vision.<tenant>.staging.iacv.com.br`.

## 4.4 — Conectar e configurar o servidor

```bash
ssh -i ~/.ssh/id_ed25519_iacv root@staging.iacv.com.br

# Dentro do VPS, rodar UM por vez:
apt update && apt upgrade -y
apt install -y docker.io docker-compose-plugin curl tar

# Inicializar Swarm
docker swarm init --advertise-addr $(hostname -I | awk '{print $1}')

# Criar usuário deploy (sem sudo, só docker)
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# Criar diretórios
mkdir -p /opt/iacv/scripts /backups/predeploy /etc/iacv
chown -R deploy:deploy /opt/iacv /backups/predeploy

# Liberar SSH para o usuário deploy
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys

# Testar
exit  # sair do root
ssh -i ~/.ssh/id_ed25519_iacv deploy@staging.iacv.com.br 'docker ps'
```

Deve listar (vazio é OK) os containers, sem pedir senha.

## 4.5 — Deploy do Traefik (proxy reverso)

Crie no servidor o arquivo `/opt/iacv/traefik.yml`:

```bash
ssh deploy@staging.iacv.com.br
mkdir -p /opt/iacv && cd /opt/iacv

cat > traefik.yml <<'EOF'
version: "3.8"
services:
  traefik:
    image: traefik:v3.1
    command:
      - "--api.dashboard=true"
      - "--providers.swarm=true"
      - "--providers.swarm.exposedbydefault=false"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--entrypoints.web.http.redirections.entrypoint.to=websecure"
      - "--entrypoints.web.http.redirections.entrypoint.scheme=https"
      - "--certificatesresolvers.le.acme.email=seu@email.com"
      - "--certificatesresolvers.le.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.le.acme.tlschallenge=true"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik-letsencrypt:/letsencrypt
    networks:
      - traefik-public
    deploy:
      placement:
        constraints:
          - node.role == manager

volumes:
  traefik-letsencrypt:

networks:
  traefik-public:
    external: true
EOF

docker network create --driver=overlay traefik-public
docker stack deploy -c traefik.yml traefik
```

Aguardar 2 min e testar:

```bash
curl -I http://staging.iacv.com.br
# deve retornar 404 do Traefik (ainda sem serviço, mas Traefik está vivo)
```

## ✅ Critério de "fase 4 pronta"

```bash
ssh deploy@staging.iacv.com.br 'docker service ls'
# deve listar traefik_traefik com 1/1 replicas
```

---

# FASE 5 — Configurar GitHub: secrets + environments (30 min)

**Objetivo:** dar ao pipeline as credenciais e gates para deployar.

## 5.1 — Criar chave SSH dedicada para o GitHub Actions

Essa chave fica no GitHub Secret e é usada **só** pelo CI.
Diferente da sua chave pessoal de admin.

Na **sua máquina local**:

```bash
ssh-keygen -t ed25519 -C "github-actions-iacv-staging" \
  -f ~/.ssh/iacv_staging_actions -N ""
```

Adicione a pública no servidor:

```bash
cat ~/.ssh/iacv_staging_actions.pub | \
  ssh -i ~/.ssh/id_ed25519_iacv deploy@staging.iacv.com.br \
  'cat >> /home/deploy/.ssh/authorized_keys'
```

Teste:

```bash
ssh -i ~/.ssh/iacv_staging_actions deploy@staging.iacv.com.br 'whoami'
# deve imprimir: deploy
```

## 5.2 — Adicionar secrets no GitHub

```bash
# STAGING (Repository secrets)
gh secret set STAGING_HOST --body "staging.iacv.com.br"
gh secret set STAGING_USER --body "deploy"
gh secret set STAGING_SSH_KEY < ~/.ssh/iacv_staging_actions
gh secret set STAGING_AUTH_USER --body "admin"
gh secret set STAGING_AUTH_PASS --body "<senha-do-admin-staging>"

# Slack (opcional — pode pular agora)
gh secret set SLACK_WEBHOOK --body "https://hooks.slack.com/services/..."
```

Para verificar:

```bash
gh secret list
```

## 5.3 — Criar Environment "staging"

Pelo navegador (mais fácil que CLI pra essa parte):

1. Vá em https://github.com/tarcisioazevedo/iacloud-vison/settings/environments
2. Clique **"New environment"**
3. Nome: `staging`
4. **NÃO** marque "Required reviewers" (deploy automático)
5. Em "Deployment branches": **Selected branches** → `dev`
6. Save

> Os 3 environments de produção (`production-canary`, `production-batch`,
> `production-full`) serão criados na Fase 8. Ainda não temos servidor
> de produção.

## ✅ Critério de "fase 5 pronta"

```bash
gh secret list | grep STAGING
```

Deve listar 5 secrets (HOST, USER, SSH_KEY, AUTH_USER, AUTH_PASS).

---

# FASE 6 — Primeiro deploy de TESTE em staging (20 min)

**Objetivo:** rodar o `deploy.yml` pela primeira vez, deployar a imagem
`:latest` em staging, ver o pipeline funcionando ponta-a-ponta.

## 6.1 — Subir um stack mínimo no staging

Antes do primeiro deploy, o staging precisa ter UM stack pra atualizar.
Vamos subir manualmente uma vez:

```bash
ssh deploy@staging.iacv.com.br
cd /opt/iacv

# Pull manual da imagem
docker pull ghcr.io/tarcisioazevedo/iacloud-vison:latest

# Stack mínimo (vai evoluir conforme você monta)
cat > staging.yml <<'EOF'
version: "3.8"
services:
  vision:
    image: ghcr.io/tarcisioazevedo/iacloud-vison:latest
    networks:
      - traefik-public
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.iacv-staging.rule=Host(`staging.iacv.com.br`)"
        - "traefik.http.routers.iacv-staging.entrypoints=websecure"
        - "traefik.http.routers.iacv-staging.tls.certresolver=le"
        - "traefik.http.services.iacv-staging.loadbalancer.server.port=8971"
      restart_policy:
        condition: on-failure
networks:
  traefik-public:
    external: true
EOF

docker stack deploy -c staging.yml iacv-staging
```

Aguardar 3 min e testar:

```bash
curl -fsv https://staging.iacv.com.br/version
# deve retornar a versão do IACV
```

## 6.2 — Disparar deploy via workflow_dispatch

```bash
gh workflow run Deploy \
  -f target=staging \
  -f image_tag=latest

gh run watch
```

Acompanhe os steps. Se falhar, leia o log:

```bash
gh run view --log-failed
```

## 6.3 — Erros mais prováveis na primeira vez

| Erro | Causa | Solução |
|---|---|---|
| `Permission denied (publickey)` | Chave errada no secret | Re-rode o `gh secret set STAGING_SSH_KEY` |
| `Host key verification failed` | DNS errado | Confira `STAGING_HOST` |
| `tenants.conf not found` | Esqueceu Fase 4.4 | Crie o arquivo no host |
| `Smoke tests failed: snapshot` | Nenhuma câmera configurada | Comente o teste #5 do `smoke-tests.sh` |
| `Healthcheck timeout` | App sem `/version` | OK ignorar nesse teste mínimo |

## ✅ Critério de "fase 6 pronta"

O run do workflow termina com **status: success**, mesmo que
alguns smoke tests falhem (configurar câmera vem depois).

---

# FASE 7 — Pausa para você consolidar (1 dia)

Antes de partir para produção, **pare por 1 dia**. Use staging.

Coisas pra fazer enquanto isso:

- [ ] Configurar uma câmera real no staging
- [ ] Testar smoke tests passando 100%
- [ ] Configurar Grafana + Loki (ver Cap. 11 do PDF)
- [ ] Deixar o staging rodando 24h pra ver se trava ou cresce em RAM
- [ ] Fazer o primeiro **rollback** de teste:
  ```bash
  ssh deploy@staging.iacv.com.br
  bash /opt/iacv/scripts/rollback.sh
  ```
- [ ] Fazer o primeiro **backup** de teste:
  ```bash
  ssh deploy@staging.iacv.com.br
  TENANT_FILTER=staging bash /opt/iacv/scripts/pre-deploy-backup.sh
  ```

**Por que pausar?** Porque em produção você não vai ter espaço para
descobrir que tem bug. Quanto mais maduro estiver staging, melhor.

---

# FASE 8 — Provisionar produção (2 horas)

**Objetivo:** repetir as Fases 4 e 5, mas para um VPS de produção
maior, e configurar os 3 environments com gates humanos.

## 8.1 — Provisionar VPS de produção

Mesma receita da Fase 4, com:
- **VPS maior:** 4 vCPU, 8 GB, 200 GB SSD (~R$ 200/mês)
- **Domínio:** `iacv.com.br` (sem `staging.`)
- **DNS:** `*.iacv.com.br → IP_PROD`
- **Hostname diferente:** `prod-iacv-01`
- **Chave SSH diferente:** gere `~/.ssh/iacv_prod_actions`

Tudo o mais é igual: instalar Docker, Swarm, criar deploy user, Traefik,
diretórios.

## 8.2 — Adicionar secrets de produção

> ⚠️ Esses vão **dentro dos environments**, não como repository secrets.
> Isso impede que jobs sem aprovação acessem credenciais de prod.

Pelo navegador:

1. https://github.com/tarcisioazevedo/iacloud-vison/settings/environments
2. **New environment** → `production-canary`
3. **Required reviewers** → adicione você mesmo
4. **Wait timer:** 0 minutos (canário não espera)
5. **Deployment branches:** Selected → `main`
6. Em **Environment secrets**, adicione:
   - `PROD_HOST` = `iacv.com.br`
   - `PROD_USER` = `deploy`
   - `PROD_SSH_KEY` = conteúdo da `~/.ssh/iacv_prod_actions`
   - `PROD_AUTH_USER` = `admin`
   - `PROD_AUTH_PASS` = sua senha de admin de produção
7. Save

Repita para criar `production-batch` (igual, mas **wait timer: 60 min** + **2 reviewers**) e `production-full` (igual, mas **wait timer: 240 min** + **2 reviewers**).

## 8.3 — Configurar `tenants.conf` em produção

```bash
ssh -i ~/.ssh/iacv_prod_actions deploy@iacv.com.br

sudo tee /etc/iacv/tenants.conf <<'EOF'
# Comece simples — só com 1 tenant interno
CANARY_TENANTS=("demo")
BATCH_TENANTS=()
EOF
```

À medida que você for ganhando clientes, atualize esse arquivo.

## 8.4 — Subir o primeiro tenant em produção (`demo`)

```bash
ssh deploy@iacv.com.br
cd /opt/iacv

cat > demo-stack.yml <<'EOF'
version: "3.8"
services:
  vision:
    image: ghcr.io/tarcisioazevedo/iacloud-vison:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8971/version"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    networks:
      - traefik-public
    volumes:
      - vision-demo_config:/config
      - vision-demo_media:/media
    deploy:
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.demo.rule=Host(`vision.demo.iacv.com.br`)"
        - "traefik.http.routers.demo.entrypoints=websecure"
        - "traefik.http.routers.demo.tls.certresolver=le"
        - "traefik.http.services.demo.loadbalancer.server.port=8971"
      restart_policy:
        condition: on-failure

volumes:
  vision-demo_config:
  vision-demo_media:

networks:
  traefik-public:
    external: true
EOF

docker stack deploy -c demo-stack.yml vision-demo
```

## ✅ Critério de "fase 8 pronta"

```bash
curl -fs https://vision.demo.iacv.com.br/version
# deve retornar a versão
```

E no GitHub:
```
Settings → Environments
```
Lista 4 environments: `staging`, `production-canary`, `production-batch`, `production-full`.

---

# FASE 9 — Primeira release em produção (30 min)

**Objetivo:** lançar `v0.1.0` (sua primeira versão tagueada) e ver
todo o pipeline canário → batch → full funcionando.

## 9.1 — Garantir que `dev` tem o que vai pra produção

```bash
git checkout dev
git pull origin dev
git log --oneline -5
```

## 9.2 — Mergear `dev` em `main`

```bash
gh pr create --base main --head dev \
  --title "Release v0.1.0" \
  --body "Primeira release oficial em produção."

# Aguardar reviews (você + alguém)
# Mergear pelo navegador ou:
# gh pr merge --merge
```

## 9.3 — Criar a tag

```bash
git checkout main
git pull origin main
git tag -a v0.1.0 -m "Primeira release oficial"
git push origin v0.1.0
```

A partir desse `git push origin v0.1.0`:
- `build-cloud.yml` builda → `:v0.1.0` no GHCR
- `release.yml` retageia para multi-arch
- `deploy.yml` dispara → **production-canary** pede sua aprovação

## 9.4 — Aprovar canário

```bash
gh run watch
```

Quando aparecer "waiting for approval", abra:
https://github.com/tarcisioazevedo/iacloud-vison/actions

Clique no run, **Review deployments** → marque `production-canary` → **Approve and deploy**.

Aguarde ~5 min. O tenant `demo` é atualizado.

## 9.5 — Validar e aprovar batch + full

```bash
curl -fs https://vision.demo.iacv.com.br/version
# deve mostrar v0.1.0
```

Se OK, espere o **wait timer** (60 min) terminar e aprove `production-batch` (vai fazer no-op porque a lista batch está vazia).

Aprove `production-full` também (vai atualizar nada também, já que só tem o tenant `demo`).

## ✅ Critério de "fase 9 pronta"

```bash
gh run list --workflow=Deploy --limit 1
```

Status: **completed / success**.

Você acabou de fazer **seu primeiro deploy controlado em produção**. 🎉

---

# Daqui pra frente

Agora você tem:
- ✅ Repo no GitHub com branches protegidas
- ✅ CI rodando em todo PR
- ✅ Imagens no GHCR versionadas
- ✅ Staging com pipeline automático
- ✅ Produção com pipeline canário → batch → full
- ✅ 1 tenant interno (`demo`) em produção
- ✅ Tag `v0.1.0` lançada

Próximos passos sugeridos (próximas semanas):

1. **Adicionar primeiro cliente real** — replique o `demo-stack.yml`
   com novo nome, novas labels, novo volume
2. **Configurar Sentry** (Cap. 11 do PDF)
3. **Configurar Grafana + Loki** (Cap. 11 do PDF)
4. **Configurar backup horário** (Cap. 12 do PDF)
5. **Treinar 2ª pessoa** nos runbooks (Caps. 8, 9 do PDF)
6. **Primeiro teste de DR** trimestral (Runbook 04)

Tudo isso está documentado no **PDF principal** (`IACV-Plano-Producao.pdf`).

---

# Em caso de incidente HOJE

Mesmo no início, mantenha à mão:

| Situação | Vá em |
|---|---|
| Erro 500 em prod | `runbooks/02-rollback.md` |
| Bug crítico que precisa fix urgente | `runbooks/03-hotfix.md` |
| Comandos rápidos | `scripts/deploy/README.md` |
| Configuração travou | `docs/producao/DEPLOY-WORKFLOW.md` cap. 5 (troubleshooting) |

---

> Este documento é o roteiro do "primeira vez". Depois de terminar a Fase 9,
> você pode arquivar este arquivo e usar `DEPLOY-WORKFLOW.md` no dia-a-dia.
