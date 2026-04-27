# Runbook 04 — Backup e Restore

**Quando usar:** rotina diária de backup, antes de cada deploy, e em caso de DR (Disaster Recovery).
**RPO alvo:** 1 hora. **RTO alvo:** 30 minutos.

---

## O que é guardado em backup

Por tenant, três classes de dados:

| Classe | Volume | Frequência | Retenção | Onde |
|---|---|---|---|---|
| **config.db** (SQLite) | `vision-${TENANT}_config` | A cada 1h | 30 dias | S3 + local |
| **Recordings** (video) | `vision-${TENANT}_media` | Contínuo (S3 sync) | 90 dias | S3 |
| **Snapshots** (jpg) | `vision-${TENANT}_media` | Contínuo (S3 sync) | 30 dias | S3 |

A app **já tem** sync para S3 (`frigate/s3_sync.py`). O que falta é o backup periódico do `config.db`.

---

## Backup horário do config.db (cron)

Criar o script `/opt/iacv/scripts/backup-config.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/backups/hourly
S3_BUCKET=s3://iacv-backups/config-db
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)

for TENANT in $(docker stack ls --format '{{.Name}}' | grep '^vision-'); do
  OUT="${BACKUP_DIR}/${TENANT}-${TS}.tar.gz"

  docker run --rm \
    -v ${TENANT}_config:/data:ro \
    -v "${BACKUP_DIR}":/backup \
    alpine tar czf "/backup/$(basename ${OUT})" /data 2>/dev/null

  # Upload S3
  aws s3 cp "$OUT" "${S3_BUCKET}/${TENANT}/" --quiet

  echo "OK: ${TENANT} -> ${OUT}"
done

# Limpar locais antigos (mantém em S3)
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +1 -delete

# Limpar S3 com lifecycle (configurar bucket policy: 30 dias)
```

Permissões e cron:

```bash
chmod +x /opt/iacv/scripts/backup-config.sh

# Cron: a cada hora cheia
crontab -e
# Adicionar:
0 * * * * /opt/iacv/scripts/backup-config.sh >> /var/log/iacv-backup.log 2>&1
```

---

## Backup pré-deploy (manual, antes de release/hotfix)

```bash
ssh prod-host
mkdir -p /backups/predeploy

TS=$(date +%Y%m%d-%H%M)
for TENANT in $(docker stack ls --format '{{.Name}}' | grep '^vision-'); do
  docker run --rm \
    -v ${TENANT}_config:/data:ro \
    -v /backups/predeploy:/backup \
    alpine tar czf /backup/${TENANT}-${TS}.tar.gz /data
done

# Validar integridade dos tarballs
for f in /backups/predeploy/*-${TS}.tar.gz; do
  tar tzf "$f" > /dev/null && echo "OK: $f" || echo "FALHA: $f"
done

# Subir para S3 (segundo destino — defesa em profundidade)
aws s3 sync /backups/predeploy/ s3://iacv-backups/predeploy/${TS}/
```

**Não prosseguir** com deploy se algum tar tiver falha.

---

## Restore — Um único tenant

Caso um tenant precise voltar a um ponto no tempo:

```bash
ssh prod-host
TENANT=tenant_x
TS_RESTORE=20260427-1430  # data/hora do backup desejado

# 1. Parar o serviço
docker service scale vision-${TENANT}_vision=0
sleep 10

# 2. Backup do estado atual (caso precise voltar)
docker run --rm \
  -v vision-${TENANT}_config:/data:ro \
  -v /backups/restore-rollback:/backup \
  alpine tar czf /backup/vision-${TENANT}-before-restore-$(date +%Y%m%d-%H%M).tar.gz /data

# 3. Baixar backup do S3 se não estiver local
aws s3 cp s3://iacv-backups/config-db/vision-${TENANT}/vision-${TENANT}-${TS_RESTORE}.tar.gz \
  /tmp/restore.tar.gz

# 4. Limpar volume e restaurar
docker run --rm \
  -v vision-${TENANT}_config:/data \
  alpine sh -c 'rm -rf /data/*'

docker run --rm \
  -v vision-${TENANT}_config:/data \
  -v /tmp:/backup:ro \
  alpine tar xzf /backup/restore.tar.gz -C /

# 5. Subir
docker service scale vision-${TENANT}_vision=1

# 6. Validar
sleep 30
curl -fs https://vision.${TENANT}.iacv.example.com/version
docker service logs --tail 50 vision-${TENANT}_vision
```

---

## Restore — Disaster Recovery (host inteiro perdido)

Cenário: VPS de produção perdido. Precisa recriar tudo.

### DR.1 — Provisionar novo host

- [ ] VPS novo com mesma especificação (CPU, RAM, disco)
- [ ] Instalar Docker, Docker Swarm
- [ ] Restaurar `/etc/letsencrypt`, configurações Traefik
- [ ] Apontar DNS (TTL baixo durante DR)

### DR.2 — Restaurar volumes a partir do S3

```bash
# Listar tenants que existiam
aws s3 ls s3://iacv-backups/config-db/ | awk '{print $2}' | sed 's|/||'

# Para cada tenant
TENANTS=$(aws s3 ls s3://iacv-backups/config-db/ | awk '{print $2}' | sed 's|/||')
for TENANT in $TENANTS; do
  # Pegar o backup mais recente
  LATEST=$(aws s3 ls s3://iacv-backups/config-db/${TENANT}/ | sort | tail -1 | awk '{print $4}')

  # Criar volume
  docker volume create ${TENANT}_config

  # Baixar e restaurar
  aws s3 cp s3://iacv-backups/config-db/${TENANT}/${LATEST} /tmp/${TENANT}.tar.gz

  docker run --rm \
    -v ${TENANT}_config:/data \
    -v /tmp:/backup:ro \
    alpine tar xzf /backup/${TENANT}.tar.gz -C /

  echo "OK: ${TENANT}"
done
```

### DR.3 — Recordings (apenas do S3)

Os recordings ficam **somente no S3** (não em backup local — ocupam TB). A app, ao subir, consulta o S3 para apresentar histórico.

Validar que o `frigate/s3_sync.py` está apontando para o bucket correto via env vars:
```
ICV_S3_ENDPOINT
ICV_S3_BUCKET
ICV_S3_ACCESS_KEY
ICV_S3_SECRET_KEY
```

### DR.4 — Subir os stacks

```bash
# Para cada tenant, deploy do stack a partir do template
for TENANT in $TENANTS; do
  ICV_TENANT_SLUG=$TENANT \
  ICV_LICENSE_KEY=$(get_license_for $TENANT) \
  docker stack deploy -c docker-compose.cloud.yml vision-${TENANT}
done
```

### DR.5 — Validação

```bash
for TENANT in $TENANTS; do
  echo -n "${TENANT}: "
  curl -fs --max-time 10 https://vision.${TENANT}.iacv.example.com/version || echo "FALHOU"
done
```

---

## Teste de DR (recomendado: trimestral)

Para garantir que o restore **realmente funciona**:

1. Provisionar VPS de teste (descartável)
2. Executar DR.1 a DR.4 com tenants reais (ou amostra)
3. Validar que dados aparecem corretamente
4. Documentar tempo total (atualizar RTO se necessário)
5. Destruir o VPS de teste

**Sem teste, o backup é só esperança — não é seguro.**

---

## Política de retenção (resumo)

```
config.db:
  - Local (host de prod):     últimos 7 dias  (24/dia = 168 versões)
  - S3 (versionado):          30 dias rolling
  - Pré-deploy:               mantido por 90 dias (segurança extra)

Recordings:
  - S3:                       90 dias (lifecycle policy)
  - Glacier (long-term):      1 ano (eventos com label "evidence")

Snapshots:
  - S3:                       30 dias

Logs (Loki):
  - Ativos:                   14 dias
  - S3 archive:               1 ano
```

---

## Comandos rápidos (cola)

```bash
# Backup imediato de 1 tenant
TENANT=xxx
docker run --rm -v vision-${TENANT}_config:/data:ro \
  -v /backups/manual:/backup alpine \
  tar czf /backup/${TENANT}-$(date +%Y%m%d-%H%M).tar.gz /data

# Listar backups disponíveis (S3)
aws s3 ls s3://iacv-backups/config-db/vision-${TENANT}/ --human-readable

# Validar último backup (extrair e checar)
aws s3 cp s3://iacv-backups/config-db/vision-${TENANT}/$(aws s3 ls ... | sort | tail -1 | awk '{print $4}') /tmp/check.tar.gz
tar tzf /tmp/check.tar.gz | head
```
