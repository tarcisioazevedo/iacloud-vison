# IACV — Plano de Produção

Documentação completa para colocar e manter o IA Cloud Vision em produção
com segurança, ambientes separados, deploys automatizados e rollback rápido.

## Entregáveis principais

| Arquivo | O que é | Quando usar |
|---|---|---|
| [`IACV-Plano-Producao.pdf`](./IACV-Plano-Producao.pdf) | Plano estratégico completo (43 páginas) | Leitura inicial, treinamento, decisões |
| [`DEPLOY-WORKFLOW.md`](./DEPLOY-WORKFLOW.md) | Guia operacional do pipeline `deploy.yml` | Configurar e operar o deploy automatizado |
| [`runbooks/`](./runbooks/) | Procedimentos passo-a-passo | Durante incidente / deploy manual |

### PDF — Plano de Produção

Conteúdo:

| Cap. | Tópico |
|------|--------|
| 1 | Sumário executivo |
| 2 | Princípios de missão crítica |
| 3 | Arquitetura de ambientes (DEV / CI / STAGING / PROD) |
| 4 | Estratégia de branches Git |
| 5 | Pipeline CI/CD (GitHub Actions + GHCR) |
| 6 | Estratégia de testes (6 níveis) |
| 7 | Procedimento de deploy (canário + blue-green) |
| 8 | Procedimento de rollback (simples + com restore de DB) |
| 9 | Procedimento de hotfix emergencial |
| 10 | Migrations de banco (expand-and-contract) |
| 11 | Monitoramento e alertas |
| 12 | Backup e Disaster Recovery |
| 13 | Plano de implementação em 90 dias |
| 14 | Runbooks detalhados (4 procedimentos) |
| Anexo A | Comandos úteis (cola rápida) |
| Anexo B | Template de postmortem |

## Estrutura de pastas

```
docs/producao/
├── IACV-Plano-Producao.pdf        # PDF estratégico (43 páginas)
├── DEPLOY-WORKFLOW.md             # Guia operacional do deploy.yml
├── README.md                      # este arquivo (índice)
├── gerar_diagramas.py             # regera os PNGs
├── gerar_pdf.py                   # regera o PDF
├── diagramas/                     # 7 imagens dos fluxos
│   ├── 01-arquitetura-ambientes.png
│   ├── 02-fluxo-branches.png
│   ├── 03-pipeline-cicd.png
│   ├── 04-fluxo-deploy-canario.png
│   ├── 05-fluxo-rollback.png
│   ├── 06-fluxo-hotfix.png
│   └── 07-runbook-incidente.png
└── runbooks/                      # procedimentos passo-a-passo
    ├── 01-deploy-producao.md
    ├── 02-rollback.md
    ├── 03-hotfix.md
    └── 04-backup-restore.md
```

### Arquivos relacionados (fora de docs/producao/)

```
.github/workflows/deploy.yml       # Pipeline GitHub Actions (4 estágios)
scripts/deploy/                    # Scripts shell rodados no host
├── README.md                      # Doc dos scripts
├── swarm-update.sh                # Rolling update + auto-rollback
├── list-tenants.sh                # Categoriza tenants (canary/batch/all)
├── pre-deploy-backup.sh           # Backup do config.db
├── smoke-tests.sh                 # 8 testes pós-deploy
├── verify-versions.sh             # Confirma versão em todos os tenants
└── rollback.sh                    # Rollback rápido (caminho A)
```

## Como regenerar

Caso atualize a estratégia ou os runbooks:

```bash
cd docs/producao
python gerar_diagramas.py    # regera os 7 PNGs
python gerar_pdf.py           # regera o PDF (lê os PNGs e os MDs)
```

Dependências (Python 3.10+):

```bash
pip install reportlab matplotlib pillow pypdf pypdfium2
```

## Como usar este documento

1. **Leitura inicial** (todos da equipe): capítulos 1 a 5 — contexto geral.
2. **Quem faz deploy**: capítulos 7, 8, 9, 10 + Runbooks 01, 02, 03.
3. **Quem opera o servidor**: capítulos 11, 12 + Runbooks 02, 04.
4. **Liderança técnica**: capítulo 13 (plano 90 dias) para priorizar
   investimento de tempo da equipe.

Os runbooks são **documentos vivos**. Toda vez que houver incidente,
atualize-os com o que aprendeu. O hábito é tão importante quanto o
conteúdo.

## Princípios

Guardar pra quando bater dúvida em decisão de produção:

1. **Imutabilidade** — a imagem que vai pra prod é a MESMA testada em staging
2. **Reversibilidade** — toda mudança precisa de rollback em < 5 min
3. **Observabilidade** — sem métricas/logs não há deploy
4. **Gradualidade** — 1 tenant interno → 10% → 100%, nunca all-at-once
5. **Automação do tedioso, manualidade do crítico** — gate humano antes de prod

---

> Documento confidencial — distribuir apenas para a equipe interna autorizada.
