# Runbook 02 — Rollback de Produção

**Quando usar:** quando uma versão recém-deployada apresenta problema em produção.
**MTTR alvo:** < 5 min (rollback simples) / < 30 min (com restore de DB).

---

## Decisão: qual tipo de rollback?

```
A nova versão rodou MIGRATION de banco?
│
├── NÃO  →  ROLLBACK SIMPLES (docker service rollback)
│
└── SIM  →  ROLLBACK COM RESTORE DE BANCO
```

**Como saber se houve migration?**

```bash
# Compare o número de migrations entre as imagens
docker run --rm ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z-1 \
  ls /opt/frigate/migrations | wc -l

docker run --rm ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z \
  ls /opt/frigate/migrations | wc -l
```

Se os números forem diferentes → **rollback com DB**.

---

## Caminho A — Rollback simples (< 2 min)

```bash
ssh prod-host
TENANT=tenant_afetado

# Opção 1: rollback automático do Swarm (volta pra imagem anterior)
docker service rollback vision-${TENANT}_vision

# Opção 2: forçar uma tag específica
docker service update \
  --image ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z-1 \
  --update-order start-first \
  vision-${TENANT}_vision
```

**Validar:**

```bash
# Versão voltou
curl -s https://vision.${TENANT}.iacv.example.com/version

# Healthcheck OK
docker service ps vision-${TENANT}_vision | head -5

# Logs limpos
docker service logs --tail 50 vision-${TENANT}_vision
```

Se múltiplos tenants foram afetados, rodar o loop:

```bash
TENANTS_AFETADOS="tenant_a tenant_b tenant_c"
for TENANT in $TENANTS_AFETADOS; do
  docker service rollback vision-${TENANT}_vision
done
```

---

## Caminho B — Rollback com restore de banco (15–30 min)

**ATENÇÃO:** este procedimento causa downtime de ~5 min por tenant.

### B.1 — Preparar

```bash
ssh prod-host
TENANT=tenant_afetado

# Localizar o backup pré-deploy (Fase 0 do Runbook 01)
ls -lh /backups/predeploy/vision-${TENANT}-*.tar.gz | tail -3

# Confirmar ID do backup correto
BACKUP=/backups/predeploy/vision-${TENANT}-20260427-1430.tar.gz
```

### B.2 — Parar o serviço

```bash
docker service scale vision-${TENANT}_vision=0
sleep 10
docker service ps vision-${TENANT}_vision  # confirmar que parou
```

### B.3 — Restaurar o volume

```bash
# Backup do estado corrompido (caso precise para postmortem)
docker run --rm \
  -v vision-${TENANT}_config:/data:ro \
  -v /backups/corrupted:/backup \
  alpine tar czf /backup/vision-${TENANT}-corrupted-$(date +%Y%m%d-%H%M).tar.gz /data

# Limpar volume
docker run --rm \
  -v vision-${TENANT}_config:/data \
  alpine sh -c 'rm -rf /data/*'

# Restaurar
docker run --rm \
  -v vision-${TENANT}_config:/data \
  -v /backups/predeploy:/backup:ro \
  alpine tar xzf /backup/$(basename $BACKUP) -C /
```

### B.4 — Subir com versão antiga

```bash
docker service update \
  --image ghcr.io/tarcisioazevedo/iacloud-vison:vX.Y.Z-1 \
  vision-${TENANT}_vision

docker service scale vision-${TENANT}_vision=1
```

### B.5 — Validar

```bash
# Versão
curl -s https://vision.${TENANT}.iacv.example.com/version
# Esperado: vX.Y.Z-1

# Dados críticos: cameras retornando snapshot
curl -fso /tmp/snap.jpg https://vision.${TENANT}.iacv.example.com/api/<camera>/snapshot.jpg
file /tmp/snap.jpg

# Recordings recentes
curl -fs https://vision.${TENANT}.iacv.example.com/api/events?limit=5 | jq .
```

---

## Pós-rollback (obrigatório)

### Imediato (primeiros 30 min)

- [ ] Comunicar tenants no canal oficial
- [ ] Atualizar status page com incidente
- [ ] Snapshot de logs e métricas do momento da falha
- [ ] Issue no GitHub com label `incident:p0` ou `p1`

### Em 48 h

- [ ] **Postmortem completo** seguindo template em `/docs/templates/postmortem.md`:
  - Timeline detalhada (UTC)
  - Root cause (5 whys)
  - Impacto (tenants afetados, duração, SLA)
  - O que funcionou bem na resposta
  - O que falhou
  - Ações preventivas (cada uma vira issue no GitHub)

- [ ] **Não tentar redeploy da versão problemática** até:
  - Root cause identificado
  - Fix em hotfix branch + testes adicionados
  - Smoke tests cobrindo o cenário do incidente

- [ ] **Atualizar este runbook** se descobriu cenário não coberto

---

## Comandos de emergência (cola rápida)

```bash
# Rollback de um tenant
docker service rollback vision-<TENANT>_vision

# Rollback de TODOS os tenants (situação crítica)
for s in $(docker service ls --format '{{.Name}}' | grep '^vision-'); do
  docker service rollback "$s"
done

# Listar versões em execução
for s in $(docker service ls --format '{{.Name}}' | grep '^vision-'); do
  echo -n "$s: "
  docker service inspect "$s" --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
done

# Forçar uma tag específica
docker service update --image ghcr.io/.../iacloud-vison:vX.Y.Z vision-<TENANT>_vision
```
