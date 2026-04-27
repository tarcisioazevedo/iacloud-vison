# Runbook 03 — Hotfix Emergencial

**Quando usar:** bug crítico em produção que **NÃO** pode esperar pelo próximo release.
**MTTR alvo:** < 30 min do diagnóstico ao deploy.

> **NÃO use hotfix se:** o problema requer migration de banco, refactor maior, ou se um rollback resolve. Hotfix é para fix mínimo e cirúrgico.

---

## Critérios para hotfix

Use o caminho de hotfix **somente se TODOS estes pontos forem verdadeiros**:

- [ ] Severidade P0 ou P1 (impacto significativo aos tenants)
- [ ] Rollback **não** é opção (versão antiga também tem o bug, ou seria perda de feature crítica)
- [ ] Fix cabe em **≤ 50 linhas de código**
- [ ] Não requer alteração de schema do banco
- [ ] Existe (ou consegue criar em < 10 min) um teste de regressão

Se algum item for falso → use **Runbook 02 — Rollback** + planejar fix no próximo release.

---

## Fase 1 — Setup (3 min)

```bash
# Estar em main atualizado (NUNCA partir de dev em hotfix)
git checkout main
git pull --ff-only origin main

# Confirmar tag atual em produção
git describe --tags
# exemplo: v1.2.3

# Criar branch hotfix
git checkout -b hotfix/v1.2.4-camera-stream-crash
```

---

## Fase 2 — Fix mínimo (15 min)

**Regra:** **uma** mudança, **um** arquivo idealmente, com teste regression.

```bash
# Editar APENAS o necessário
$EDITOR frigate/camera_stream.py

# Adicionar teste que falha sem o fix
$EDITOR tests/test_camera_stream.py

# Rodar testes localmente
make test
# ou
pytest tests/test_camera_stream.py -v
```

**Commit:**

```bash
git add frigate/camera_stream.py tests/test_camera_stream.py
git commit -m "fix(camera): handle null frame in stream restart

Quando a câmera reinicia o stream sem frame inicial, evita NPE
no decoder. Adiciona teste regression.

Refs: incident #42
Severity: P0"
```

---

## Fase 3 — PR + CI (5–10 min)

```bash
git push -u origin hotfix/v1.2.4-camera-stream-crash

# Criar PR (gh CLI)
gh pr create \
  --base main \
  --title "[HOTFIX] fix(camera): handle null frame in stream restart" \
  --body "$(cat <<'EOF'
## Severidade
P0 — câmeras travando quando há perda de stream

## Causa
Decoder recebe `None` no frame após restart, causando crash no thread de processamento.

## Fix
Validar `frame is not None` antes de decode.

## Teste
- [x] Unit test adicionado em `tests/test_camera_stream.py`
- [x] Reproduzido localmente com mock
- [x] CI verde

## Plano de deploy
Deploy direto em produção via canário (1 tenant interno → batch → 100%).
Tempo estimado: 25 min.
EOF
)" \
  --label "hotfix" --label "severity:p0"
```

**Aprovação:** **2 reviewers** obrigatórios mesmo em emergência (mas review rápido — < 5 min).

---

## Fase 4 — Tag + Release (2 min)

Após PR mergeado em `main`:

```bash
git checkout main
git pull --ff-only origin main

# Tag patch (incremento do PATCH)
git tag -a v1.2.4 -m "Hotfix v1.2.4 — camera stream null frame"
git push origin v1.2.4
```

O `release.yml` builda automaticamente a imagem `ghcr.io/.../iacloud-vison:v1.2.4` (5–8 min).

Acompanhe:
```bash
gh run list --workflow=release.yml --limit 5
gh run watch
```

---

## Fase 5 — Deploy emergencial (10 min)

**Modo emergencial:** canário reduzido (15 min) ao invés de 1 h.

```bash
ssh prod-host

# 1. Backup rápido (5 min)
for TENANT in $(docker stack ls --format '{{.Name}}' | grep '^vision-'); do
  docker run --rm \
    -v ${TENANT}_config:/data:ro \
    -v /backups/hotfix:/backup \
    alpine tar czf /backup/${TENANT}-$(date +%Y%m%d-%H%M).tar.gz /data &
done
wait

# 2. Canário em 1 tenant interno (15 min observação)
docker service update \
  --image ghcr.io/tarcisioazevedo/iacloud-vison:v1.2.4 \
  --update-order start-first \
  --update-failure-action rollback \
  vision-demo_vision

# Aguardar e verificar
sleep 60
curl -s https://vision.demo.iacv.example.com/version  # v1.2.4
docker service logs --tail 50 vision-demo_vision

# 3. Se OK em 15 min → deploy em todos
sleep 900  # 15 min de observação

ALL_TENANTS=$(docker stack ls --format '{{.Name}}' | grep '^vision-' | sed 's/^vision-//; s/_vision$//')
for TENANT in $ALL_TENANTS; do
  docker service update \
    --image ghcr.io/tarcisioazevedo/iacloud-vison:v1.2.4 \
    --update-order start-first \
    --update-failure-action rollback \
    vision-${TENANT}_vision
  sleep 20
done
```

---

## Fase 6 — Back-merge (3 min)

**OBRIGATÓRIO:** garantir que `dev` também tem o fix.

```bash
git checkout dev
git pull --ff-only origin dev
git merge main --no-ff -m "chore: back-merge hotfix v1.2.4 into dev"
git push origin dev
```

Sem isso, o próximo release **regride o fix** (catástrofe).

---

## Fase 7 — Postmortem (em 48 h)

- [ ] Postmortem escrito (template `/docs/templates/postmortem.md`)
- [ ] Issue de prevenção criada com label `prevention`
- [ ] Teste adicional cobrindo cenário (se faltava)
- [ ] Atualizar este runbook se descobriu lacuna no processo

---

## Anti-patterns (NÃO faça)

| Anti-pattern | Por quê | O que fazer |
|---|---|---|
| Hotfix com 200+ linhas | Aumenta risco de novo bug | Rollback + release planejado |
| Hotfix incluindo nova feature | "Já que estamos mexendo..." | Hotfix é só o fix |
| Pular review por urgência | 2 olhos pegam bobagem | 2 reviewers em < 5 min |
| Deploy direto sem canário | Risco de derrubar todos | Canário de 15 min mínimo |
| Esquecer back-merge para dev | Regressão no próximo release | Sempre back-merge |
| Hotfix com migration de DB | Não é hotfix, é release | Restore de backup + release planejado |

---

## Comandos rápidos (cola)

```bash
# Hotfix em 1 comando (situação real)
git checkout main && git pull && \
git checkout -b hotfix/$(date +%Y%m%d)-fix-XYZ && \
$EDITOR frigate/file.py && \
make test && \
git add -A && git commit -m "fix: ..." && \
git push -u origin HEAD && \
gh pr create --base main --label hotfix
```
