# 25 · Plano de Implementação — IA Contador de Fluxo + ReID Multi-Câmera

> Data: 2026-05-19
> Status: Pendente aprovação para início
> Escopo: Cloud-direct cameras (sem Box/edge nesta fase)
> Duração total: **13 dias úteis** (4 sprints)
> Pré-requisito atendido: R2 funcionando + `vsaas-ai-worker` em prod

---

## Objetivo

Entregar funcionalidade de **contador de fluxo em tempo real** com **bounding boxes ao vivo**, **tripwire configurável**, **dashboard analítico** e **ReID multi-câmera** — vendável aos integradores como módulo cobrável por câmera/mês.

**Meta de receita:** R$35-85/câmera/mês (markup 15-20x sobre custo de inferência).

---

## Arquitetura geral

```
Câmera Cloud-Direct (RTSP/SRT)
        │
        ▼
go2rtc (transcode + fanout)
        │
        ├─────────────────────────┐
        │                         │
        ▼                         ▼
Recording (já existe)       vsaas-ai-worker (Python)
   → R2 storage                 ├─ YOLOv8 (detecção)
                                ├─ Norfair (tracking)
                                ├─ Tripwire crossing (NOVO)
                                └─ ReID embeddings (Fase 2)
                                       │
                                       ▼
                       POST /detections/ingest
                       POST /detections/event
                       WS  /live/detections/:cameraId   ← NOVO (SSE/WebSocket)
                                       │
                                       ▼
                              Backend (Express/Prisma)
                                       │
                                       ├─ DetectionEvent
                                       ├─ AnalyticsEvent (agregação)
                                       ├─ TripwireEvent (NOVO)
                                       └─ PersonTrack (Fase 2)
                                       │
                                       ▼
                              Frontend (React)
                              ├─ LivePage overlay bbox
                              ├─ TripwireEditorPage (NOVO)
                              ├─ AnalyticsPage dados reais
                              └─ ReIDJourneyPage (Fase 2)
```

---

## Sprint 1 — Bounding Box Live + Filtros (3 dias)

### Objetivo
Mostrar bboxes verdes em tempo real sobre o LivePlayer, com filtros por tipo de objeto. Contagem básica de "pessoas detectadas agora".

### Tarefas

#### 1.1 Worker → Backend stream de detecções (1 dia)
**Arquivo:** `vsaas-ai-worker/camera_worker.py`

- Adicionar canal de publicação em tempo real além do POST existente
- Worker publica em Redis pub/sub: `detections:{cameraId}` com payload:
  ```json
  {
    "ts": 1779168000,
    "cameraId": "...",
    "frame": { "width": 1920, "height": 1080 },
    "detections": [
      { "trackId": "trk_8a3f", "type": "person", "confidence": 0.94,
        "bbox": [0.18, 0.30, 0.32, 0.72] }
    ]
  }
  ```
- Throttle: máximo 5 publicações/s por câmera (suficiente para UI fluida)

**Arquivo backend:** `vsaas-backend/src/routes/live-detections.ts` (NOVO)
- Rota SSE: `GET /live/detections/:cameraId`
- Subscribe Redis pub/sub e repassa eventos como SSE
- Auth via JWT + verifica acesso à câmera (multi-tenant)

#### 1.2 Frontend overlay no LivePlayer (1 dia)
**Arquivo:** `vsaas-frontend/src/components/LivePlayer.tsx`

- Adicionar `<canvas>` absolutamente posicionado sobre o `<video>`
- Hook `useDetections(cameraId)` que abre EventSource e mantém último frame
- Desenha bboxes proporcionais (coordenadas normalizadas 0-1)
- Cores por tipo: pessoa=emerald, veículo=cyan, animal=amber, outros=indigo
- Label: `TIPO · CC%` em fonte mono no canto superior do box
- Performance: requestAnimationFrame, descarta frames velhos (> 500ms)

#### 1.3 Painel de filtros (meio dia)
**Arquivo novo:** `vsaas-frontend/src/components/LiveDetectionFilters.tsx`

- Checkboxes: Pessoa, Veículo, Animal, Pacote, Bicicleta, Arma (Pro)
- Toggle: mostrar bbox, mostrar labels
- Slider de confiança mínima (filtra client-side)
- Persiste seleção em localStorage por câmera

#### 1.4 KPI overlay live (meio dia)
- Componente sobreposto canto inferior do player
- Mostra: pessoas detectadas agora / entradas hoje / saídas hoje
- Atualiza via SSE
- Glassmorphism `bg-black/60 backdrop-blur`

### Entregável Sprint 1
Demonstração: Larix apontada para sala, alguém anda na frente, **box verde segue em tempo real** no frontend. Toggle de objetos funciona ao vivo. Contador "pessoas: 2" atualiza instantaneamente.

### Critério de aceite
- Latência detecção → bbox visível: < 1.5s
- 5 FPS de updates no overlay sem travamento da UI
- 100% das pessoas detectadas pelo worker aparecem como bbox
- Toggle de tipo filtra instantaneamente sem reload

---

## Sprint 2 — Tripwire + Contagem Direcional (2 dias)

### Objetivo
Editor visual de linhas/zonas, contagem direcional de entradas/saídas, alertas automáticos.

### Tarefas

#### 2.1 Schema + persistência (meio dia)
**Arquivo:** `vsaas-backend/prisma/schema.prisma`

Adicionar campos à `Camera`:
```prisma
model Camera {
  // ...
  tripwiresJson Json?    // [{ id, name, x1, y1, x2, y2, objects: [], direction, cooldownSec, confMin, alerts: [] }]
  zonesJson     Json?    // [{ id, name, polygon: [[x,y]...], objects: [], purpose }]
}

model TripwireEvent {
  id          String   @id @default(uuid())
  cameraId    String
  camera      Camera   @relation(fields: [cameraId], references: [id])
  tripwireId  String
  tripwireName String  // denormalizado pra histórico
  trackId     String
  objectType  String   // "person", "vehicle", ...
  direction   String   // "in" | "out"
  confidence  Float
  occurredAt  DateTime @default(now())
  thumbnailUrl String?  // R2 path do crop no momento

  @@index([cameraId, occurredAt])
  @@index([cameraId, direction, occurredAt])
}
```

Migration: `20260520_tripwire_events`

#### 2.2 Lógica de cruzamento no worker (meio dia)
**Arquivo novo:** `vsaas-ai-worker/tripwire.py`

```python
def side_of_line(point, line):
    """Retorna sinal: positivo = lado A, negativo = lado B."""
    x, y = point
    (x1, y1), (x2, y2) = line
    return (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)

def check_crossing(track, tripwire):
    if len(track.history) < 2:
        return None
    line = ((tripwire["x1"], tripwire["y1"]), (tripwire["x2"], tripwire["y2"]))
    prev_side = side_of_line(track.history[-2].bottom_center, line)
    curr_side = side_of_line(track.history[-1].bottom_center, line)
    if prev_side * curr_side < 0:  # sinal mudou = cruzou
        # Direção configurada como "in" se cruzou para o lado positivo
        crossed_to_positive = curr_side > 0
        direction = "in" if (tripwire["direction"] == "positive") == crossed_to_positive else "out"
        return direction
    return None
```

- Worker carrega `tripwires` da câmera via `/internal/cameras/ai-enabled`
- Cooldown por trackId (Set com timestamp, descarta cruzamentos < N segundos)
- Filtra por `objectType` permitido na tripwire
- Filtra por confidence média do track ≥ `confMin`
- Posta evento: `POST /detections/tripwire-cross`

#### 2.3 Endpoint backend (meio dia)
**Arquivo:** `vsaas-backend/src/routes/detections.ts`

```typescript
detectionsRouter.post('/tripwire-cross',
  requireAiWorkerAuth,
  asyncHandler(async (req, res) => {
    const body = TripwireCrossSchema.parse(req.body)

    // Upload thumbnail to R2 (se enviado)
    const thumbnailUrl = body.thumbnailBase64
      ? await uploadDetectionThumb(integradorId, body)
      : null

    const event = await prisma.tripwireEvent.create({
      data: {
        cameraId, tripwireId, tripwireName, trackId,
        objectType, direction, confidence, thumbnailUrl,
      }
    })

    // Trigger alertas configurados
    await checkAndFireAlerts(camera, event)

    res.json({ ok: true, eventId: event.id })
  }))
```

#### 2.4 Editor visual (meio dia)
**Arquivo novo:** `vsaas-frontend/src/pages/TripwireEditorPage.tsx`

- Canvas SVG sobreposto ao snapshot da câmera
- Ferramentas: linha, retângulo, polígono
- Drag handles para reposicionar (cursor `grab`)
- Painel direito: nome, objetos, direção, confidence, cooldown, alertas
- Botão "teste em tempo real" — habilita o tripwire por 60s e mostra contagem ao vivo
- Salvar persiste em `Camera.tripwiresJson` via PATCH

#### 2.5 Alertas (meio dia)
**Arquivo:** `vsaas-backend/src/services/notify.service.ts`

Adicionar novos eventos:
```typescript
| 'CAMERA_TRIPWIRE_CROSS'
| 'CAMERA_TRIPWIRE_PEAK_ANOMALY'      // pico anormal
| 'CAMERA_TRIPWIRE_AFTERHOURS'        // entrada fora de horário
| 'CAMERA_ZONE_EMPTY_TOO_LONG'        // zona vazia > X min em horário comercial
```

Cada alerta dispara via canais configurados (push, email, **whatsapp**, sse).

### Entregável Sprint 2
Integrador desenha uma linha na tela da câmera com mouse, salva, e a partir daí cada pessoa que cruza gera um evento. Contador hoje vira real. Alerta no WhatsApp do operador quando entrada fora de horário acontece.

### Critério de aceite
- Editor funciona com mouse desktop + touch mobile
- Cruzamento detectado correto em 95%+ dos casos (oclusão pode falhar)
- Cooldown elimina contagem dupla quando pessoa para em cima da linha
- Alerta WhatsApp chega em < 5s após cruzamento

---

## Sprint 3 — Dashboard Analytics Real (3 dias)

### Objetivo
A `AnalyticsPage` hoje tem UI completa mas zero dados. Sprint 3 alimenta com dados reais agregados.

### Tarefas

#### 3.1 Agregação contínua (1 dia)
**Arquivo novo:** `vsaas-backend/src/jobs/aggregate-tripwire-stats.ts`

- Job CRON a cada 5 minutos
- Para cada câmera com tripwire ativo, agrega últimos 5min:
  - Total entradas/saídas por tripwire
  - Ocupação atual = max(0, sum(entradas) - sum(saídas))
  - Tempo médio entre entrada e saída do mesmo trackId
- Insere em `AnalyticsEvent` por hora cheia
- Job diário 00:05 BRT: agrega dia completo

**Schema novo:**
```prisma
model TripwireStats {
  id          String   @id @default(uuid())
  cameraId    String
  tripwireId  String
  hourBucket  DateTime  // truncado em hora UTC
  entries     Int      @default(0)
  exits       Int      @default(0)
  occupancyEndOfHour Int @default(0)
  avgDwellTimeSec    Int?

  @@unique([cameraId, tripwireId, hourBucket])
  @@index([cameraId, hourBucket])
}
```

#### 3.2 Endpoints analytics (meio dia)
**Arquivo:** `vsaas-backend/src/routes/analytics.ts` (existe? criar/expandir)

```
GET /analytics/flow/kpis?cameraId=&from=&to=
  → { entries, exits, currentOccupancy, avgDwellTime, deltaVsYesterday }

GET /analytics/flow/hourly?cameraId=&date=
  → { hours: [{ hour, entries, exits, occupancy }] }

GET /analytics/flow/heatmap?cameraId=&from=&to=
  → 7×24 matrix com counts

GET /analytics/flow/zones?cameraId=&date=
  → [{ zoneId, name, visits, avgTime }]
```

Todas com `resolveIntegradorId` + filtro de acesso multi-tenant.

#### 3.3 Frontend charts reais (1 dia)
**Arquivo:** `vsaas-frontend/src/pages/AnalyticsPage.tsx`

- Substituir mocks por hooks SWR
- Charts com recharts (já no projeto?) ou Apex
  - Barras agrupadas entrada/saída por hora
  - Área de ocupação sobreposta
  - Heatmap 7×24 customizado
  - Funil de conversão (calçada → vitrine → loja) se múltiplas câmeras
- Skeleton loaders enquanto carrega

#### 3.4 Insights automáticos com Gemini (meio dia)
**Arquivo novo:** `vsaas-backend/src/services/ai-insights.service.ts`

- Job diário 06:00 BRT
- Para cada cliente final, gera prompt:
  > "Loja X teve N entradas hoje vs Y ontem. Pico foi às Zh. Comparado à média da semana: ... Gere 2-3 insights práticos em português."
- Salva em `AnalyticsEvent` tipo INSIGHT
- Frontend mostra em card destacado no topo

### Entregável Sprint 3
AnalyticsPage com dados reais. Cliente final entra no painel de manhã e vê "Ontem você teve 247 entradas (+18%). Pico 14h. Sugestão: abra 2º caixa nesse horário."

### Critério de aceite
- Dashboard carrega em < 2s para 30 dias de dados
- KPIs batem com soma manual dos TripwireEvents
- Insights úteis em pelo menos 70% dos dias (não bobagem do tipo "tudo normal")

---

## Sprint 4 — ReID Multi-Câmera (5 dias) — Fase 2

### Objetivo
A mesma pessoa recebe o mesmo PersonID em todas as câmeras do site. Permite jornada multi-câmera, busca por foto, identificação de clientes recorrentes.

### Tarefas

#### 4.1 Adicionar modelo ReID ao worker (1 dia)
**Arquivo:** `vsaas-ai-worker/requirements.txt`

Adicionar:
- `onnxruntime==1.18.0`
- `numpy>=1.26`

**Arquivo novo:** `vsaas-ai-worker/reid.py`

- Usa modelo **OSNet** (Omni-Scale Network) em ONNX
  - Modelo: `osnet_x0_25_msmt17.onnx` (~3MB, rápido em CPU)
  - Alternativa: TorchReID ou FastReID se GPU disponível
- Extrai feature vector 512-dim por bbox de pessoa
- Normaliza (L2) para comparação por cosine similarity

```python
class ReIDExtractor:
    def __init__(self, model_path):
        self.sess = ort.InferenceSession(model_path)

    def extract(self, person_crop_bgr):
        # crop → resize 128x256 → normalize → infer
        feature = self.sess.run(None, {"input": preprocessed})[0]
        return feature / np.linalg.norm(feature)  # L2 normalized
```

#### 4.2 Schema PersonTrack (meio dia)
```prisma
model PersonTrack {
  id            String   @id @default(uuid())
  // shortCode visível na UI ("#4F2A")
  shortCode     String   @unique @default(dbgenerated("substr(md5(random()::text), 1, 4)"))
  integradorId  String
  siteId        String?  // todos os tracks dentro de um site compartilham espaço de ID

  firstSeenAt   DateTime
  lastSeenAt    DateTime
  totalCameras  Int      @default(1)

  // Embedding consolidado (média dos últimos N detecções)
  embedding     Unsupported("vector(512)")?

  // Atributos opcionais detectados
  clothingTopColor    String?
  clothingBotColor    String?
  hasBackpack         Boolean?

  // Classificação manual
  label         String?   // "VIP", "FUNCIONARIO", "SUSPEITO"
  notes         String?

  detections    DetectionEvent[]

  @@index([integradorId, siteId])
  @@index([lastSeenAt])
}

model DetectionEvent {
  // ... campos existentes
  personTrackId String?
  personTrack   PersonTrack? @relation(fields: [personTrackId], references: [id])
  reidEmbedding Unsupported("vector(512)")?
}
```

#### 4.3 Lógica de associação cross-camera (1 dia)
**Arquivo:** `vsaas-backend/src/services/person-track.service.ts`

Quando worker posta evento com embedding:
```typescript
async function associateOrCreatePersonTrack(
  integradorId: string,
  siteId: string,
  embedding: number[],
  detectedAt: Date,
): Promise<PersonTrack> {
  // Busca tracks ativos no mesmo site nos últimos 30min
  const candidates = await prisma.$queryRaw<Array<{id: string, distance: number}>>`
    SELECT id, embedding <=> ${embedding}::vector AS distance
    FROM "PersonTrack"
    WHERE "integradorId" = ${integradorId}
      AND "siteId" = ${siteId}
      AND "lastSeenAt" > NOW() - INTERVAL '30 minutes'
    ORDER BY distance
    LIMIT 1
  `

  if (candidates[0]?.distance < 0.35) {  // threshold de match
    // Atualiza embedding consolidado (média móvel) e lastSeenAt
    return updatePersonTrack(candidates[0].id, embedding, detectedAt)
  }

  // Cria novo PersonTrack
  return prisma.personTrack.create({...})
}
```

**Threshold de 0.35** baseado em literatura OSNet. Calibrar com dados reais nas primeiras 2 semanas.

#### 4.4 Busca por foto (1 dia)
**Endpoint:** `POST /persons/search-by-photo`

```typescript
// Recebe foto, extrai face/pessoa, busca no DB
const upload = await uploadMiddleware(req)
const photo = upload.buffer

// Chama worker via HTTP interno (worker tem o modelo)
const { embedding } = await aiWorkerClient.extractReID(photo)

const matches = await prisma.$queryRaw`
  SELECT pt.*, pt.embedding <=> ${embedding}::vector AS distance
  FROM "PersonTrack" pt
  WHERE pt."integradorId" = ${integradorId}
  ORDER BY distance
  LIMIT 20
`

res.json({ matches: matches.filter(m => m.distance < 0.5) })
```

#### 4.5 Frontend ReIDJourneyPage (1 dia)
**Arquivo novo:** `vsaas-frontend/src/pages/ReIDJourneyPage.tsx`

- Banner com PersonTrack selecionado (cor, atributos, tempo total)
- Grid 2×2 de câmeras onde a pessoa apareceu
- Cada câmera mostra bbox específico desse PersonID
- Timeline cronológica com timestamps + ações na pessoa
- Painel direito: busca por foto, tracks similares, ações (watchlist, VIP, blocklist)

### Entregável Sprint 4
Polícia chega após furto. Sobe foto do suspeito. Em 3 segundos: "essa pessoa apareceu em 4 câmeras, ficou 8min na loja, saiu sem passar no caixa, primeira aparição 14:24". PDF forense gerado em mais 10 segundos.

### Critério de aceite
- ReID match correto > 80% para mesma pessoa em câmeras com sobreposição
- ReID match correto > 60% sem sobreposição (caso difícil)
- Busca por foto retorna resultado em < 3s para 30 dias de tracks
- UI mostra todos os PersonTracks únicos do dia

---

## Aspectos não-funcionais

### Pricing por tier

| Tier | Recursos | Preço/cam/mês |
|---|---|---|
| **Smart Motion** | YOLO + tripwire + contador básico | R$35 |
| **Smart Analytics** | + dashboards + heatmap + insights Gemini | R$55 |
| **ReID Pro** | + jornada multi-câmera + busca por foto | R$85 |

### Schema de billing
```prisma
model Camera {
  // ...
  aiTier  String?  // "MOTION" | "ANALYTICS" | "REID_PRO"
}
```

Job de fechamento mensal:
```sql
SELECT integradorId, count(*) FILTER (WHERE aiTier IS NOT NULL) as ai_cameras
FROM Camera
WHERE aiEnabled = true
GROUP BY integradorId
```

### Infraestrutura
- **vsaas-ai-worker**: roda em nó Swarm com label `role=inference`
- Adicionar GPU node se ultrapassar 30 câmeras simultâneas
- pgvector: criar índice `ivfflat` em PersonTrack.embedding após 1k registros
- Redis: pub/sub para detecções live (canal por câmera)

### Limites operacionais
- Máximo **10 tripwires por câmera** (validação no schema)
- Máximo **5 zonas por câmera**
- Throttle de notificações: máx 60/hora por integrador (anti-flood)
- Retenção de TripwireEvent: 90 dias (mesmo que segmentos R2)
- Retenção de PersonTrack: 30 dias após last_seen

### Privacidade / LGPD
- ReID e contagem de fluxo são **anônimos** (não identificam pessoa, só corpos)
- Embedding não é dado biométrico identificável → fora do regime mais estrito
- Mas exige aviso visível no estabelecimento ("Ambiente monitorado com analítica")
- Termo obrigatório do integrador antes de ativar
- Endpoint `DELETE /persons/:id` apaga PersonTrack + embeddings (right to be forgotten)

---

## Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Falso positivo na contagem (sombra, reflexo) | Média | Médio | Confidence ≥ 65%, requer track confirmado (5+ frames) |
| Worker não escala além de N câmeras | Alta | Alto | Sharding por integradorId, adicionar nodes GPU |
| ReID falha com mudança de roupa | Alta | Baixo | Vendido como "rastreamento intra-dia" — esperado |
| Latência SSE em rede ruim | Média | Baixo | Auto-reconnect, frames velhos descartados |
| pgvector lento sem índice | Baixa | Médio | Cria ivfflat aos 1k tracks, hnsw aos 100k |
| LGPD em ReID anônimo | Baixa | Médio | Termo + aviso obrigatório, sem face nem nome |

---

## Cenários de demonstração

### Demo investidor (7 minutos)
1. **0:00–1:30** — Larix apontada. Aparece bbox verde sobre o investidor. WOW.
2. **1:30–3:00** — Configura tripwire na porta. Outra pessoa cruza. Contador sobe.
3. **3:00–4:30** — Mostra dashboard de "ontem" com gráficos.
4. **4:30–6:00** — ReID: mostra mesma pessoa em 4 câmeras + jornada.
5. **6:00–7:00** — Slide: "R$85/cam/mês × 200 câmeras × 50 integradores = R$850k MRR. Custo: R$2/cam".

### Demos comerciais por vertical

**Loja Centro Boa Vista (varejo)**
- 6 câmeras, 4 tripwires (porta, vitrine, caixa, depósito)
- ROI: 1 caixa extra abre só nos picos detectados → R$2.500/mês economia em hora extra

**Condomínio Belvedere (residencial)**
- 12 câmeras, ReID Pro
- ROI: portaria reduzida em 1 turno (-R$4k/mês) + zero erro de "esqueci quem entrou"

**Restaurante Sabor (food service)**
- 4 câmeras, 2 tripwires
- ROI: ajuste de promoções por hora (+22% fluxo), conversão balcão → mesa medida

**Indústria Galpão Alfa (segurança trabalho)**
- 8 câmeras, ReID + zona de área restrita
- ROI: zero entrada em área restrita sem EPI (multa NR-6 = R$3k–10k por evento)

---

## Cronograma executivo

```
Semana 1 (5 dias)   ━━━━━ Sprint 1 + 2
                     • Bbox live   (3d)
                     • Tripwire    (2d)
                     → Demo investidor pronta

Semana 2 (5 dias)   ━━━━━ Sprint 3
                     • Dashboard analítico (3d)
                     • Buffer testes        (2d)
                     → Vendável aos integradores

Semana 3-4 (5 dias) ━━━━━ Sprint 4 — Fase 2
                     • ReID                 (5d)
                     → Diferencial vs Monuv/Segware

TOTAL: 13 dias úteis (~3 semanas)
```

---

## Próximos passos

1. **Aprovar este plano** — Tarcísio bate o martelo
2. **Sprint 1 começa imediatamente** — primeiro dia: worker→SSE de detecções
3. **Mock UI revisado em paralelo** — `docs/mockups/01-04.html` já entregues
4. **Migration prévia** — `TripwireEvent` + `TripwireStats` + `PersonTrack` desenhados antes do sprint começar
5. **Demo investidor:** marcar para o **dia 11** (após Sprint 1+2 completos com folga)

---

## Memória de design

- Mantém design system existente: slate-900/indigo-500/cyan-400, lucide icons, glassmorphism
- Reusa componentes: LivePlayer, AnalyticsPage, FacesPage estrutura
- Animation: framer-motion já no projeto, usar para transições suaves
- Mobile-first responsivo (já é regra do projeto)

---

## Referências técnicas

- YOLOv8: já em prod, modelo `yolov8n.pt` no worker
- Norfair: já em prod, tracker em `tracker.py`
- OSNet ReID: https://kaiyangzhou.github.io/deep-person-reid/
- pgvector: já instalado, `Unsupported("vector(...)")` no Prisma
- Cloudflare R2: já configurado, bucket por integrador
- Redis pub/sub: já no stack, usado pra outras coisas
- Gemini Vision: `genai.service.ts` configurado

---

**Documento gerado em: 2026-05-19**
**Próxima revisão após: Sprint 1 completo**
