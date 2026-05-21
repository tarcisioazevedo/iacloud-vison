# Planejamento — Features Comerciais IA (Gemini)

> **Data:** 2026-05-21
> **Status:** Planejamento aprovado para execução
> **Investimento total:** ~12-14 semanas de dev (1 dev) · ARPU adicional médio: R$ 150-300/cam/mês

---

## Arquitetura B2B2B

```
FABRICANTE (você) ───┐
                     │ Define features no marketplace + preços de tabela
                     ▼
INTEGRADOR ──────────┐ Escolhe features pro catálogo dele + markup
                     │ White-label + suporte
                     ▼
CLIENTE FINAL ───────  Habilita features no plano + paga mensalidade
```

Cada feature segue o mesmo ciclo:
1. **Fabricante** cria add-on no `MarketplaceProduct` (já existe schema)
2. **Integrador** habilita no catálogo, define preço final
3. **Cliente final** ativa via UI ou contrato (cobrança automática Asaas)
4. Recorrente mensal por câmera (ou por uso)

---

## Onda 1 — Quick wins (6-8 semanas)

Foco: **diferenciar e entrar no mercado** com features que ninguém entrega no nível atual.

### 🚗 LPR Inteligente — `5 sprints × 1 semana`

| Componente | Status |
|---|---|
| DB | `LicensePlateRead` (cameraId, plate, conf, ts, vehicleType, watchlistMatch) |
| Worker | Chama `genai.readPlate(jpeg)` quando YOLO detecta carro com bbox > 8% do frame |
| Backend | `/lpr/watchlist` CRUD + `/lpr/reads` listagem |
| Frontend | LivePlayer: ao clicar em carro, painel lateral mostra placa + match watchlist |
| Integração | Webhook opcional → portão automático (HTTP/MQTT) |

**Pricing:** Cliente R$ 80/cam · Integrador paga R$ 25 · Margem 69%
**Custo cloud:** ~R$ 3/cam (Gemini Flash, 1 leitura por veículo)

---

### 🎯 Alertas Semânticos — `4 sprints × 1 semana`

| Componente | Status |
|---|---|
| DB | `SemanticRule` (cameraId, prompt, scheduleCron, lastFiredAt, enabled) |
| Backend | Cron 30s polls regras enabled; faz `genai.describeLiveScene` + compara com prompt |
| Backend | Quando match: cria `DetectionEvent` + dispara `NotificationChannel` |
| Frontend | Wizard "Criar regra em linguagem natural" |
| Frontend | Lista de regras + estatísticas (quantos disparos / dia) |

**Pricing:** R$ 30/regra/mês (até 5 regras = R$ 150)
**Custo cloud:** R$ 2/regra/mês

---

### 🏭 EPI Compliance — `3 sprints × 1 semana`

| Componente | Status |
|---|---|
| Modelo | Roboflow Universe `construction-safety-gsnvb/1` (já testado no especialista) |
| Worker | Specialist router já existe — habilitar pra câmeras industriais |
| DB | `EpiViolation` (cameraId, missingEpi[], ts, snapshotUrl) |
| Frontend | Dashboard SSMA com violações por dia/turno/área |
| Frontend | Relatório PDF exportável (auditoria) |

**Pricing:** R$ 120/cam/mês
**Custo cloud:** R$ 5/cam (Roboflow inference)

---

## Onda 2 — Receita recorrente (8-10 semanas adicionais)

### 👤 Reconhecimento Facial — `4 semanas`

- Cadastro de pessoas com 3-5 fotos
- pgvector `FaceEmbedding(userId, embeddings)`
- Worker extrai embedding via Gemini quando detecta rosto
- Match top-K cosine similarity → alerta com nome
- LGPD: opt-in explícito + audit log de cada match

**Pricing:** R$ 100/cam/mês + R$ 50/pessoa cadastrada

---

### 📊 Heatmap & Analytics Retail — `3 semanas`

- Tracker (Norfair) já mantém posições — agregar em grid 32x18 por minuto
- `HeatmapBucket(cameraId, ts_bucket, grid_x, grid_y, count)`
- Frontend: overlay mapa de calor sobre snapshot + comparativo entre dias
- Funil: zona "entrada" → zona "caixa" → ratio

**Pricing:** R$ 150-300/cam/mês (depende de nº lojas)

---

### 🔍 Busca Semântica em Vídeo — `3 semanas`

- **Já existe** `SemanticEmbedding` + `caption-worker` + `SemanticSearchPage` (parcial)
- Faltam: filtro temporal + cluster por evento + thumbnail
- Captioning a cada 30s por câmera (custa R$ 3/cam/mês)

**Pricing:** R$ 50/cam/mês (add-on)

---

## Onda 3 — Diferenciação premium (8-12 semanas adicionais)

### 🚨 AI Triage — `4 semanas`

- Substitui parte do trabalho da central de monitoramento humana
- Toda detecção crítica → Gemini classifica: rotina / suspeito / crítico
- Crítico: liga API SOS (polícia integrada onde houver) + WhatsApp dono

**Pricing:** R$ 200/cam/mês — ROI absurdo (vs R$ 2.500 central)

### 🛡️ LGPD Compliance — `3 semanas`

- Blur automático de rostos/placas em vídeo exportado
- Audit log de quem acessou o quê
- Painel de "solicitações de titular" (LGPD)

**Pricing:** R$ 500/integrador/mês (não por câmera)

### 🤝 AI Assistant — `4 semanas`

- Chat operacional ("quantas pessoas entraram hoje?")
- Function calling sobre dados reais (event, recording, camera)
- **Infra já existe** em `ai-agent.service` + `chatWithTools`

**Pricing:** R$ 500/integrador/mês

---

## Schema novo (consolidado)

```prisma
// Adicionar ao schema.prisma

model LicensePlateRead {
  id            String   @id @default(uuid())
  cameraId      String
  plate         String
  confidence    Float
  vehicleType   String?  // car, truck, motorcycle
  bboxX         Float
  bboxY         Float
  bboxW         Float
  bboxH         Float
  watchlistHit  String?  // nome do match se houver
  ts            DateTime @default(now())
  camera        Camera   @relation(fields: [cameraId], references: [id])
  @@index([cameraId, ts])
  @@index([plate])
}

model LprWatchlist {
  id           String   @id @default(uuid())
  integradorId String
  plate        String
  label        String   // "Morador 101", "Visitante", "Suspeito"
  action       String   // "allow", "alert", "block"
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now())
  @@unique([integradorId, plate])
  @@index([plate])
}

model SemanticRule {
  id              String   @id @default(uuid())
  cameraId        String
  prompt          String   @db.Text  // "Avise se alguém ficar parado >5min"
  scheduleEnabled Boolean  @default(true)
  intervalSec     Int      @default(30)
  enabled         Boolean  @default(true)
  lastFiredAt     DateTime?
  fireCount       Int      @default(0)
  notifyChannels  String[] // ["push", "whatsapp", "email"]
  camera          Camera   @relation(fields: [cameraId], references: [id])
  @@index([cameraId, enabled])
}

model EpiViolation {
  id           String   @id @default(uuid())
  cameraId     String
  missingEpi   String[] // ["helmet", "vest", "gloves"]
  workerBbox   Json     // {x,y,w,h}
  snapshotKey  String?  // R2 key
  ts           DateTime @default(now())
  @@index([cameraId, ts])
}

model FaceEmbedding {
  id           String   @id @default(uuid())
  personId     String
  vector       Unsupported("vector(512)") // pgvector
  source       String   // 'enroll' | 'live'
  ts           DateTime @default(now())
  person       Person   @relation(fields: [personId], references: [id])
  @@index([personId])
}

model Person {
  id           String   @id @default(uuid())
  integradorId String
  clienteFinalId String?
  name         String
  category     String   // "morador", "funcionario", "visitante", "blacklist"
  enrolledAt   DateTime @default(now())
  active       Boolean  @default(true)
  embeddings   FaceEmbedding[]
  @@index([integradorId, category])
}

model HeatmapBucket {
  id          String   @id @default(uuid())
  cameraId    String
  tsBucket    DateTime // truncado pra hora
  gridX       Int      // 0-31
  gridY       Int      // 0-17
  count       Int      @default(1)
  @@unique([cameraId, tsBucket, gridX, gridY])
  @@index([cameraId, tsBucket])
}
```

---

## Empacotamento comercial

### Tiers (renomeação dos atuais)

| Tier | Preço | Inclui |
|---|---|---|
| **Smart Lite** | R$ 100/cam | Base + 10 detecções/dia IA |
| **Smart** | R$ 180/cam | Base + IA ilimitada + 7d gravação |
| **Smart Plus** | R$ 280/cam | Smart + 1 add-on (LPR ou FR ou EPI) |
| **Enterprise** | R$ 450/cam | Smart + até 3 add-ons + LGPD |

### Add-ons individuais (por câmera ou por uso)

| Add-on | Preço cliente | Custo cloud | Margem |
|---|---|---|---|
| LPR | R$ 80/cam | R$ 3 | 96% |
| Reconhecimento Facial | R$ 100/cam | R$ 5 | 95% |
| EPI Compliance | R$ 120/cam | R$ 5 | 96% |
| Heatmap Analytics | R$ 150/cam | R$ 4 | 97% |
| Busca Semântica | R$ 50/cam | R$ 3 | 94% |
| Alertas Semânticos | R$ 30/regra | R$ 2 | 93% |
| AI Triage | R$ 200/cam | R$ 10 | 95% |
| Pessoa Caída / Criança | R$ 300/cam | R$ 10 | 97% |

### Plataforma (cobrança fixa do integrador)

| Item | Preço |
|---|---|
| AI Assistant | R$ 500/mês |
| LGPD Compliance Center | R$ 500/mês |

---

## Roadmap de execução (semanas)

```
W1-2   ████ LPR backend + worker
W3     ███  LPR UI + watchlist
W4-5   ████ Alertas Semânticos full
W6-7   ████ EPI Compliance
W8     ███  Marketing onda 1 + materiais white-label

W9-12  ████ Reconhecimento Facial
W13-15 ████ Heatmap Retail
W16-18 ████ Busca Semântica full
W19    ███  Marketing onda 2

W20-23 ████ AI Triage
W24-26 ████ LGPD
W27-30 ████ AI Assistant
W31    ███  Marketing onda 3 + lançamento Enterprise
```

---

## Mockups

Ver `docs/mockup-features-gemini.html` para wireframes integrados dos 3 painéis (Fabricante / Integrador / Cliente Final).
