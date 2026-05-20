# 27 · Plano de Monetização VSaaS

> **Data:** 2026-05-20
> **Status:** Implementado parcial (infraestrutura) · pendente pricing público

## Arquitetura econômica

| Camada | Tecnologia | Custo |
|---|---|---|
| Detecção base 24/7 | YOLOv8 Ultralytics local | R$ 0/inferência |
| Tracking | Norfair local | R$ 0 |
| Especialistas (custom por cliente) | Roboflow Train + Inference | R$ 99/mês (Starter) |
| LLM (Pergunte à IA) | Gemini Flash via Vertex AI | R$ 5/cam/mês |
| Storage gravação | Cloudflare R2 | R$ 8/cam/mês |
| Servidor | Hetzner CCX23 | R$ 270/mês fixo |

## Tiers comerciais

### Tier 1 · Básico — R$ 80/cam/mês
- YOLO motion detection
- Gravação 7 dias R2
- Alertas básicos

### Tier 2 · Smart — R$ 180/cam/mês
- Tier 1 +
- Detecção 22 classes COCO
- Tripwire / contador
- Dashboard analytics
- Gravação 30 dias

### Tier 3 · Enterprise — R$ 400/cam/mês
- Tier 2 +
- Modelos customizados (Roboflow Train)
- Pergunte à IA com Gemini
- LGPD compliance + data residency
- Gravação 90 dias
- SLA

## Add-ons

| Add-on | Preço |
|---|---|
| Storage +30 dias | +R$ 40/cam |
| Storage 90 dias forense | +R$ 120/cam |
| Pacote Segurança (Weapon+Fall) | +R$ 60/cam |
| Pacote Indústria (PPE+Helmet) | +R$ 80/cam |
| Modelo Custom (treino + manutenção) | R$ 3.000 setup + R$ 200/cam/mês |
| Active Learning automatizado | +R$ 50/cam |

## Custos previsíveis por câmera

```
Servidor (diluído):     R$  3/cam
Storage R2 (7d basic):  R$  5/cam
Storage R2 (30d Smart): R$ 20/cam
Storage R2 (90d Ent):   R$ 60/cam
LLM Gemini (Smart+):    R$  5/cam
Roboflow (custom):      R$ 30/cam (diluído entre clientes que pagam)

TOTAL CUSTO:            R$ 15-100/cam/mês
                        (varia conforme tier)
```

## Margens

| Tier | Receita | Custo | Margem |
|---|---|---|---|
| Básico | R$ 80 | R$ 15 | 81% |
| Smart | R$ 180 | R$ 35 | 81% |
| Enterprise | R$ 400 | R$ 100 | 75% |

## Projeção 18 meses

| Mês | Câmeras | MRR | Custo | Lucro |
|---|---|---|---|---|
| 3 | 30 | R$ 6.000 | R$ 1.500 | R$ 4.500 |
| 6 | 100 | R$ 22.000 | R$ 4.000 | R$ 18.000 |
| 12 | 400 | R$ 95.000 | R$ 12.000 | R$ 83.000 |
| 18 | 1.000 | R$ 250.000 | R$ 25.000 | R$ 225.000 |

## Verticais piloto

### 1. Varejo (lojas)
- 5-10 câmeras médio
- Smart tier R$ 180
- ARPU: R$ 1.500/loja/mês

### 2. Condomínios residenciais
- 12-30 câmeras médio
- Smart + LPR R$ 220
- ARPU: R$ 5.000/condomínio/mês

## Decisões técnicas vinculadas

✅ YOLO local (Ultralytics) — base sem custo por inferência
✅ Roboflow sidecar parado (replicas=0) — ativa só para modelos custom
✅ Cloudflare R2 — storage barato com egress zero
⚠️ Ultralytics AGPL — precisa Enterprise license quando vender comercialmente
⏳ Migração futura para YOLO-NAS via ONNX puro (Apache 2.0) — quando atingir 5+ clientes

## Próximos passos

1. Migrar YOLO para YOLO-NAS ONNX puro (1-2 dias) → licença comercial limpa
2. Criar tela pública de pricing
3. Definir 2 clientes piloto verticais
4. Implementar marketplace de add-ons na UI
