# Scripts de Deploy IACV

Scripts shell que rodam **no host de produção/staging** para automatizar
deploy, backup e rollback. Usados pelo workflow `.github/workflows/deploy.yml`,
mas também podem ser executados manualmente via SSH.

## Scripts

| Script | O que faz |
|---|---|
| `swarm-update.sh` | Atualiza serviços Swarm com rolling update + auto-rollback |
| `list-tenants.sh` | Lista tenants conforme filtro (canary, batch, remaining, all) |
| `pre-deploy-backup.sh` | Backup do `config.db` antes do deploy (obrigatório) |
| `smoke-tests.sh` | 8 testes obrigatórios pós-deploy |
| `verify-versions.sh` | Confirma que todos os tenants estão na versão esperada |
| `rollback.sh` | Rollback rápido (caminho A do Runbook 02) |

## Configuração inicial (no host)

### 1. Sincronizar scripts

```bash
# No host de produção
sudo mkdir -p /opt/iacv/scripts
# (scripts são copiados pelo workflow via rsync, mas pode-se sincronizar manualmente)
```

### 2. Configurar lista de tenants

```bash
sudo mkdir -p /etc/iacv
sudo tee /etc/iacv/tenants.conf <<'EOF'
# Tenants para canário (sempre primeiros, idealmente internos)
CANARY_TENANTS=("demo" "interno")

# Tenants para batch (≈10% do total — escolher os mais estáveis)
BATCH_TENANTS=("cliente_a" "cliente_b" "cliente_c")
EOF
```

Os arrays podem conter qualquer slug presente em `docker stack ls`.

### 3. Preparar diretórios de backup

```bash
sudo mkdir -p /backups/predeploy /backups/hourly
sudo chown -R deploy:deploy /backups
```

### 4. (Opcional) Configurar S3

```bash
# Para upload automático de backups
aws configure
# Ou via env vars no /etc/environment:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION
```

## Uso manual

### Deploy de 1 tenant específico

```bash
IMAGE_TAG=v1.2.3 \
TENANT_FILTER=cliente_x \
bash /opt/iacv/scripts/swarm-update.sh
```

### Deploy só do canário

```bash
IMAGE_TAG=v1.2.3 \
TENANT_FILTER=canary \
bash /opt/iacv/scripts/swarm-update.sh
```

### Backup pré-deploy (obrigatório antes de deploy de mão)

```bash
TENANT_FILTER=all \
S3_BUCKET=s3://iacv-backups/predeploy \
bash /opt/iacv/scripts/pre-deploy-backup.sh
```

### Rollback de emergência

```bash
# Volta para a versão anterior automaticamente
TENANT_FILTER=all bash /opt/iacv/scripts/rollback.sh

# Ou para uma versão específica
TARGET_VERSION=v1.2.2 \
TENANT_FILTER=all \
bash /opt/iacv/scripts/rollback.sh
```

### Verificar versões em produção

```bash
EXPECTED_VERSION=v1.2.3 \
bash /opt/iacv/scripts/verify-versions.sh
```

### Rodar smoke tests manualmente

```bash
BASE_URL=https://staging.iacv.example.com \
AUTH_USER=admin \
AUTH_PASS=senha \
EXPECTED_VERSION=v1.2.3 \
bash scripts/deploy/smoke-tests.sh
```

## Permissões necessárias

O usuário SSH (ex: `deploy`) deve ter:
- Membro do grupo `docker` (sem sudo)
- Acesso de escrita em `/backups/predeploy`
- Permissão para ler `/etc/iacv/tenants.conf`

```bash
sudo usermod -aG docker deploy
sudo chown deploy:deploy /backups/predeploy
sudo chmod 644 /etc/iacv/tenants.conf
```

## Ordem de execução típica (release)

```
1. pre-deploy-backup.sh (TENANT_FILTER=canary)
2. swarm-update.sh      (TENANT_FILTER=canary)
3. smoke-tests.sh       (BASE_URL do canário)
   ↓ aguardar 1h, validar métricas
4. pre-deploy-backup.sh (TENANT_FILTER=batch)
5. swarm-update.sh      (TENANT_FILTER=batch)
   ↓ aguardar 4h, validar métricas
6. pre-deploy-backup.sh (TENANT_FILTER=remaining)
7. swarm-update.sh      (TENANT_FILTER=remaining)
8. verify-versions.sh
```

Em situação **normal**, isso é tudo automatizado pelo workflow `deploy.yml`
(com gates humanos entre as etapas). Use os scripts manualmente apenas
em situações de emergência ou para testes.
