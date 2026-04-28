# Wizard "Nova Câmera" — Spec de Integração Frontend

Documento técnico para o time do Vsaas frontend. Descreve o contrato de API
com o backend VSaaS para o fluxo de criação de câmeras em ambiente
multi-tenant.

Última atualização: fluxo testado e validado em runtime (2026-04-24).

---

## Contexto de tenancy

Toda requisição autenticada traz um JWT. O backend lê o payload e aplica
isolamento automaticamente:

- `SUPER_ADMIN`: vê todos os recursos (operadores da plataforma).
- `INTEGRADOR_ADMIN`: vê recursos dos ClientesFinais que pertencem a ele.
- `CLIENT_ADMIN` / `CLIENTE_OPERADOR` / `VIEWER`: vê apenas do próprio
  ClienteFinal.

O frontend **nunca** precisa filtrar por tenant — é transparente. Se pedir um
recurso de outro tenant, a API devolve **404** (intencionalmente não vaza
existência).

---

## Endpoint 1 — Listar sites do tenant

Use para popular o **dropdown "SITE"** do wizard. Deve ser chamado ao abrir
o wizard (cache OK por 60s via SWR).

```http
GET /sites
Authorization: Bearer <jwt>
```

Opcional: `?includeInactive=true` para mostrar sites desativados (default: só
ativos).

**Resposta 200:**

```json
{
  "sites": [
    {
      "id": "site-demo-001",
      "name": "Piso Térreo",
      "address": null,
      "city": "São Paulo",
      "state": "SP",
      "active": true,
      "clienteFinal": {
        "id": "cliente-demo-001",
        "name": "Shopping Boa Vista",
        "tradeName": null
      },
      "_count": { "cameras": 1 }
    }
  ],
  "total": 1
}
```

**UX sugerida para o dropdown:**

```
Piso Térreo — Shopping Boa Vista (1 câmera)
```

Agrupar por `clienteFinal.name` quando o integrador tem mais de um cliente.

**Caso especial — tenant sem sites:**

Se `total === 0`, o wizard deve bloquear o próximo passo e mostrar CTA:

> Nenhum site cadastrado. Cadastre um site antes de adicionar câmeras.
> [Cadastrar novo site]

O botão leva pra um fluxo separado (POST /sites, abaixo).

---

## Endpoint 2 — Criar um site (onboarding)

Usado quando o integrador vai cadastrar seu primeiro site. Apenas
`SUPER_ADMIN` e `INTEGRADOR_ADMIN` podem chamar.

```http
POST /sites
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Payload mínimo:**

```json
{
  "clienteFinalId": "uuid-do-cliente",
  "name": "Loja Centro"
}
```

**Campos opcionais:** `address`, `city`, `state`, `country` (default `"BR"`),
`latitude`, `longitude`, `timezone` (default `"America/Sao_Paulo"`).

**Resposta 201:** o Site criado com `id`.

**Erros possíveis:**
- `401` — sem JWT
- `403` — role não autorizada
- `400 VALIDATION_ERROR` — campo obrigatório faltando ou formato inválido
- `404 NOT_FOUND "Cliente final não encontrado"` — `clienteFinalId` não
  pertence ao integrador do JWT

---

## Endpoint 3 — Criar câmera

Chamado pelo botão "Criar Câmera" no passo REVISAR do wizard.

```http
POST /cameras
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Campos obrigatórios:**

| Campo | Tipo | Notas |
|---|---|---|
| `siteId` | string (UUID) | Vem do dropdown SITE. O backend rejeita com 404 se não pertencer ao tenant. |
| `name` | string (1-120) | Nome amigável ("Câmera Entrada Norte"). |
| `rtspMainUrl` | string | URL do stream principal. |
| `tier` | enum | Veja tabela abaixo. |
| `pipeline` | enum | Veja tabela abaixo. |

**Tiers suportados:**

| Valor | Tipo | Quando usar |
|---|---|---|
| `BRONZE`, `SILVER`, `GOLD`, `PLATINUM` | Comerciais | Planos fixos do IA Cloud Vision. `priceMonthlyBrl` pode ser omitido. |
| `STATIC_VISION` | Técnico | Pipeline 1 — Cloud Vision API (pay-per-call). Exige `priceMonthlyBrl`. |
| `STREAMING_ANALYTICS` | Técnico | Pipeline 2 — Vertex AI Vision (pay-per-hour). Exige `priceMonthlyBrl`. |

**Pipelines suportados:**

| Valor | Descrição |
|---|---|
| `EDGE_HYBRID` | Edge YOLOv8 → Cloud Vision API (consumo misto) |
| `EDGE_YOLO` | 100% edge, YOLO local, sem cloud AI. Menor custo, funciona offline. |
| `VERTEX_STREAMING` | Streaming RTSP → Vertex AI Vision no Google Cloud |

**Campos opcionais relevantes:**

- `priceMonthlyBrl` — se ausente e `tier` é comercial, backend resolve pela
  pricing table (SILVER=49,90; GOLD=149,90; etc). Se `tier` é técnico,
  obrigatório.
- `description`, `location`
- `rtspSubUrl`, `rtspUsername`, `rtspPassword`
- `brand`, `model`, `resolution`, `fps`, `codec`
- `hwAccel` (`NONE` | `VAAPI` | `NVIDIA_NVDEC` | `INTEL_QSV_H264` | ...)
- `detectorType` (`CPU` | `CORAL_USB` | `TENSORRT` | ...)
- `motionEnabled`, `recordEnabled`, `recordMode`, `recordRetainDays`
- `faceRecognitionEnabled`, `lprEnabled`, `genaiEnabled`
- `zones[]` — zonas podem vir embutidas na criação (ou cadastradas depois)

**Exemplo de payload mínimo (como o wizard envia):**

```json
{
  "siteId": "site-demo-001",
  "name": "Entrada Principal",
  "rtspMainUrl": "rtsp://admin:pass@192.168.0.222:554/Streaming/Channels/102",
  "tier": "SILVER",
  "pipeline": "EDGE_YOLO",
  "resolution": "1920x1080",
  "fps": 15,
  "codec": "h264",
  "hwAccel": "NONE",
  "detectorType": "CPU"
}
```

**Resposta 201:** a Camera criada com `id`, `subscription` embutido (inclui
`priceMonthlyBrl` resolvido), `zones`, `enabledModels`.

**Erros esperados:**

| HTTP | Mensagem | Causa provável |
|---|---|---|
| `400 VALIDATION_ERROR` | `"siteId: Required"` | Frontend esqueceu de mandar siteId |
| `400 VALIDATION_ERROR` | `"priceMonthlyBrl é obrigatório para tier técnico \"STATIC_VISION\" (pay-as-you-go)"` | Tier técnico sem preço |
| `401 UNAUTHORIZED` | `"Não autorizado"` | Sem JWT ou token expirado |
| `403 FORBIDDEN` | `"Apenas integradores podem cadastrar câmeras"` | Role sem permissão |
| `404 NOT_FOUND` | `"Site não encontrado"` | siteId não existe OU pertence a outro tenant |
| `400 VALIDATION_ERROR` | `"tier: Invalid enum value"` | Valor fora da lista suportada |

---

## UX recomendada para o wizard

### Passo 1 — SITE (novo, adicionar antes do INFO atual)

```
┌─ SITE ────────────────────────────────────────┐
│ Selecione o site onde a câmera será instalada │
│                                               │
│ [▾ Piso Térreo — Shopping Boa Vista  (1 cam)] │
│                                               │
│ Sem nenhum site? [+ Cadastrar novo site]      │
└───────────────────────────────────────────────┘
```

- Dropdown populado por `GET /sites`.
- "Último site usado" em primeiro lugar (local storage) para cadastros em
  série de uma mesma obra.
- Se `total === 0`, bloquear avanço e oferecer onboarding.

### Passo 2-7 — como hoje (INFO / RTSP / DETECTOR / MOTION / AVANÇADO / RETENÇÃO / REVISAR)

Nenhuma mudança necessária. Na tela de REVISAR, adicione a linha:

```
SITE
├── Cliente:   Shopping Boa Vista
└── Local:     Piso Térreo
```

### Tela de erro — traduzir mensagens técnicas

As mensagens do backend vêm em formato `campo: descrição`. Exemplos do que
exibir na UI ao receber 400:

| Mensagem do backend | Texto para o usuário |
|---|---|
| `siteId: Required` | "Selecione um site antes de continuar." |
| `priceMonthlyBrl é obrigatório para tier técnico...` | "Este tipo de plano exige um valor mensal. Use Silver/Gold/Platinum para preços fixos." |
| `Site não encontrado` | "O site selecionado não está mais disponível. Atualize a lista." |
| `tier: Invalid enum value...` | "Tipo de plano inválido." |

---

## Pricing table (para exibir preço na UI)

Valores em BRL/mês, configuráveis via env `ICV_PRICE_*` sem redeploy:

| Tier | Preço padrão | Env var |
|---|---|---|
| BRONZE | R$ 19,90 | `ICV_PRICE_BRONZE` |
| SILVER | R$ 49,90 | `ICV_PRICE_SILVER` |
| GOLD | R$ 149,90 | `ICV_PRICE_GOLD` |
| PLATINUM | R$ 399,90 | `ICV_PRICE_PLATINUM` |
| STATIC_VISION | n/a | pay-as-you-go |
| STREAMING_ANALYTICS | n/a | pay-per-hour |

**Nota:** não há endpoint de pricing ainda; se quiser evitar hardcode no
frontend, pedir ao backend para expor `GET /pricing` (trivial, avise se
quiser que eu adicione).

---

## Autenticação — credenciais de desenvolvimento (seed)

O `npm run db:seed` cria:

| Role | Email | Senha |
|---|---|---|
| SuperAdmin | `admin@iacloudvision.com.br` | `Admin@123` |
| Integrador | `integrador@visaocorp.com.br` | `Integrador@123` |
| Operador | `operador@shoppingboavista.com.br` | `Operador@123` |

E um site de demo: `site-demo-001` — "Piso Térreo", cliente "Shopping Boa
Vista".

---

## Checklist de implementação frontend

- [ ] Criar hook `useSites()` que chama `GET /sites` via SWR (cache 60s).
- [ ] Adicionar passo SITE no começo do wizard (antes de INFO).
- [ ] Enviar `siteId` no payload do `POST /cameras`.
- [ ] Remover envio do campo `priceMonthlyBrl` quando `tier` for
      BRONZE/SILVER/GOLD/PLATINUM (backend resolve via pricing).
- [ ] Tratar respostas 400/404 com as mensagens amigáveis da tabela acima.
- [ ] Fluxo de onboarding quando `total === 0` sites (CTA + `POST /sites`).
- [ ] Na tela REVISAR, mostrar cliente+site escolhidos.
- [ ] (Opcional) Sticky do "último site usado" em localStorage.
