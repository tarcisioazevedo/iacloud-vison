# Runbook 01 — Deploy em Produção

**Quando usar:** liberar uma nova versão (`vX.Y.Z`) para os tenants em produção.
**MTTR alvo:** 30–60 min (com canário). **Downtime por tenant:** 10–30 s.

---

## Pré-requisitos

- [ ] PR mergeado em `dev` e `release/vX.Y.Z` criado
- [ ] CI verde em todos os jobs (lint, unit, integration, build multi-arch)
- [ ] Imagem `ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z` publicada no GHCR
- [ ] CHANGELOG.md atualizado com a versão
- [ ] Janela de deploy combinada com tenants críticos (se aplicável)
- [ ] Acesso SSH ao host de produção
- [ ] Backups recentes de todos os tenants (< 24 h)

---

## Fase 0 — Backup preventivo (5 min)

Em produção, **antes de qualquer coisa**, backup de todos os volumes:

```bash
# Para cada tenant
for TENANT in $(docker stack ls --format '{{.Name}}' | grep '^vision-'); do
  docker run --rm \
    -v ${TENANT}_config:/data:ro \
    -v /backups/predeploy:/backup \
    alpine tar czf /backup/${TENANT}-$(date +%Y%m%d-%H%M).tar.gz /data
done

# Validar
ls -lh /backups/predeploy/ | tail -20
```

**Checkpoint:** todos os tenants têm um `.tar.gz` recente. Se algum falhar, **PARE** o deploy.

---

## Fase 1 — Deploy em STAGING (15 min)

```bash
# Atualizar tag no compose de staging
ssh staging-host
cd /opt/iacv-staging
sed -i "s|iacloud-vison:.*|iacloud-vison:vX.Y.Z|" docker-compose.staging.yml

# Aplicar
docker stack deploy -c docker-compose.staging.yml iacv-staging

# Aguardar healthcheck
watch -n 5 'docker service ls | grep iacv-staging'
```

**Smoke tests:**

```bash
# 1. Versão correta
curl -s https://staging.iacv.example.com/version
# esperado: vX.Y.Z

# 2. Stats acessível (autenticado)
curl -su admin:senha https://staging.iacv.example.com/stats | jq .

# 3. Login funciona
curl -X POST https://staging.iacv.example.com/api/login \
  -d '{"user":"admin","password":"..."}' \
  -H 'Content-Type: application/json'

# 4. Câmera de teste retornando snapshot
curl -so /tmp/snap.jpg https://staging.iacv.example.com/api/camera_test/snapshot.jpg
file /tmp/snap.jpg  # deve ser JPEG válido
```

**Checkpoint:** todos os 4 testes OK. Se algum falhar, **PARE** e investigue.

Manter staging rodando por **mínimo 1 h** observando:
- `docker service logs -f iacv-staging_vision`
- Sentry / Grafana — taxa de erro deve ser zero

---

## Fase 2 — Deploy CANÁRIO (1 tenant interno, 1h)

Escolher **1 tenant interno** (de testes/demo) — nunca cliente real no canário.

```bash
ssh prod-host
TENANT=demo  # tenant interno

docker service update \
  --image ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z \
  --update-order start-first \
  --update-failure-action rollback \
  --update-monitor 60s \
  vision-${TENANT}_vision
```

Validações imediatas:

```bash
# Versão
curl -s https://vision.${TENANT}.iacv.example.com/version

# Logs por 10 min
docker service logs -f --since 10m vision-${TENANT}_vision

# Métricas
# Acessar Grafana: https://grafana.iacv.example.com/d/iacv
# Verificar painéis: error rate, latência p95, CPU, RAM
```

**Manter rodando por 1 h.** Critérios de sucesso:
- Erro 5xx por minuto: 0
- Latência p95: dentro do baseline (verificar Grafana)
- Logs: sem `ERROR` ou `CRITICAL` recorrentes
- Câmeras: detectando objetos normalmente
- Recordings: gravando

Se algum critério falhar → **rollback** (Runbook 02).

---

## Fase 3 — Deploy BATCH (10% dos tenants, 4h)

Selecionar 10% dos tenants (preferir os menos críticos):

```bash
TENANTS_BATCH="tenant_a tenant_b tenant_c"  # 10% da lista total

for TENANT in $TENANTS_BATCH; do
  echo "Atualizando ${TENANT}..."
  docker service update \
    --image ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z \
    --update-order start-first \
    --update-failure-action rollback \
    --update-monitor 60s \
    vision-${TENANT}_vision

  # Aguardar healthcheck antes do próximo
  sleep 30
  curl -fs https://vision.${TENANT}.iacv.example.com/version || {
    echo "FALHA em ${TENANT} — abortando"
    exit 1
  }
done
```

**Manter rodando por 4 h.** Mesmos critérios da Fase 2.

---

## Fase 4 — Deploy GERAL (100% dos tenants)

Após 4 h de batch sem incidentes:

```bash
ALL_TENANTS=$(docker stack ls --format '{{.Name}}' | grep '^vision-' | sed 's/^vision-//; s/_vision$//')

for TENANT in $ALL_TENANTS; do
  # Pular os já atualizados
  CURRENT=$(curl -fs https://vision.${TENANT}.iacv.example.com/version)
  [ "$CURRENT" = "vX.Y.Z" ] && continue

  echo "Atualizando ${TENANT}..."
  docker service update \
    --image ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z \
    --update-order start-first \
    --update-failure-action rollback \
    --update-monitor 60s \
    vision-${TENANT}_vision

  sleep 30
done
```

---

## Fase 5 — Pós-deploy

- [ ] Tag `vX.Y.Z` marcada como `latest` no GHCR (release.yml já faz)
- [ ] CHANGELOG.md publicado em `/CHANGELOG.md`
- [ ] Comunicação aos tenants no canal oficial
- [ ] Postmortem se houve algum hiccup
- [ ] Backups da Fase 0 mantidos por **mínimo 7 dias**
- [ ] Imagem `vX.Y.Z-1` (anterior) mantida acessível

---

## Critérios de aborto

**ABORTAR e fazer rollback** se:
- Taxa de erro > 1% em qualquer tenant atualizado
- Latência p95 > 2x baseline
- Healthcheck `/version` retornando 5xx
- Volume de disco crescendo anormalmente (vazamento)
- Mais de 1 reclamação de cliente em 30 min

Ver **Runbook 02 — Rollback**.
