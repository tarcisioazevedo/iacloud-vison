# Runbook — Resiliência de gravação CLOUD_DIRECT

**Data:** 2026-05-12  · **Status:** Opção C aplicada; Modo A/B documentado para futuro.

## Gap conhecido

Pipeline CLOUD_DIRECT (RTMP_PUSH ou RTSP_PULL sem edge box) grava em tmpfs
do backend e sobe pro R2 async. Tmpfs é volátil — sobrevive ao processo, não
sobrevive ao restart do container.

### Cenário de perda

```
T=0    R2 cai (outage Cloudflare ou credencial expirada)
T=10s  Câmera continua pushando → segments PENDING acumulam no tmpfs
T=2min Backend reinicia (deploy, OOM, crash) → tmpfs zerado
T=3min R2 volta → worker tenta retry → arquivo .ts não existe → FAILED
```

Janela típica de perda: **30s a 2min de gravação por câmera CLOUD_DIRECT**
em cada convergência (R2 outage AND backend restart). EDGE_BOX é imune
porque a box tem HD próprio.

## O que já está mitigado (Opção C — aplicada)

`recording-upload-worker` agora detecta `local_file_missing` no 1º retry
e marca FAILED imediatamente em vez de gastar 5 tentativas inúteis.

**Benefício:** fila PENDING não infla com segments fantasmas. Operador
vê o número correto de FAILED no `/admin/recording-ops`.

**Não recupera dados** — apenas estabiliza o sintoma.

## Mitigações pendentes (não implementadas ainda)

### Modo A — Fallback secundário S3 Hetzner (1 dia)

R2 falha → tenta upload no S3 Hetzner antes de marcar PENDING.

- Vantagem: cobre 95% dos casos, infra simples
- Custo: €1-5/mês Hetzner Object Storage
- Quando ativar: **quando 1º cliente piloto pagante entrar em SLA**

### Modo B — Buffer persistente paralelo (2 dias)

Upload paralelo R2 + S3 Hetzner. S3 vira WAL durável.

- Vantagem: cobre 100%, segments sobrevivem a qualquer falha individual
- Custo: €1-5/mês + complexidade de sincronização
- Quando ativar: **quando 5+ pilotos pagantes ou SLA contratual ≥99.9%**

### Modo C — go2rtc memory buffer (1 semana)

Configurar go2rtc com buffer interno de 5min. Backend pode cair sem perder
push da câmera durante o buffer.

- Vantagem: cobre a janela de restart isoladamente
- Custo: aumentar memory limit do go2rtc
- Quando ativar: quando go2rtc 1.10+ tiver buffer estável (recurso ainda em
  desenvolvimento upstream)

## Quando o operador vê

Em `/admin/recording-ops`, painel "Segments com problema":

| uploadError | Sintoma | Ação |
|---|---|---|
| `local_file_missing` | R2 outage + restart aconteceu | Verificar logs Sentry, esperar próximo segment. Não recuperável. |
| `uploadToCloud returned false` | R2 ainda offline | Aguardar próximo tick, ou intervir no R2 dashboard |
| `integradorId not resolvable` | Tenancy quebrada | Corrigir Site/ClienteFinal/Integrador da câmera |

## Decisão arquitetural registrada

- **Opção C aplicada agora** porque é cosmética e zero infra.
- **Modo A/B parqueados** porque não tem cliente pagante pra justificar
  custo + complexidade.
- **Modo C parqueado** porque depende de upstream.
- **Quando reabrir:** quando primeiro piloto reclamar de perda OU quando
  SLA contratual exigir.

## Como reativar discussão

1. Criar issue/épico "Resiliência CLOUD_DIRECT — buffer persistente"
2. Quantificar perda real (medições de campo)
3. Decidir Modo A vs B baseado em volume e SLA
4. Provisionar Storage Box Hetzner Falkenstein
5. Implementar (~1-2 dias)
