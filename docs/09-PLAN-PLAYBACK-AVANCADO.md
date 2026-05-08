# Plano — Playback Avançado (pendências parqueadas)

**Data:** 2026-05-08
**Branch:** dev
**Status:** Planejamento — não implementado
**Autor:** Tarcísio + Claude (sessão recordings UX)

---

## Contexto

Após a entrega da timeline UX premium (commit `9d3d6dd8`), três features avançadas
ficaram parqueadas porque cada uma é, sozinha, uma rodada inteira de
desenvolvimento. Este documento explica **o que cada uma faz**, **por que
agregam valor**, **quanto custa** e **quando faz sentido fazer**.

Decisão de prioridade segue o princípio de `CLAUDE.md`: **não inventar features
sem demanda concreta**. Os 3 itens só viram backlog ativo se aparecer pedido
de cliente piloto, ou se o gap competitivo justificar.

---

## Item 1 — Sprite preview no hover

### O que é

Ao passar o mouse sobre a timeline, em vez de só mostrar a linha-guia + o
relógio, mostrar **uma miniatura visual** do frame da gravação naquele
instante. É o mesmo padrão de YouTube, Twitch, Vimeo: passa o mouse e vê
"o que tá acontecendo ali" antes de clicar.

### Por que importa

**Ganho operacional alto.** Operador de monitoramento procurando um evento
específico ("entrada do veículo às 14h") hoje precisa scrubar de 5 em 5
segundos pra achar o frame certo. Com sprite preview, ele vê todos os
momentos em paralelo só passando o mouse — encontra em segundos.

**Diferenciação competitiva.** Defense IA, Digifort e Monuv não têm.
Segware tem versão limitada (só preview de 1 frame, não sprite-sheet).

### Arquitetura proposta

**Box gera sprite-sheet, Cloud serve, frontend usa CSS background-position.**

```
Box (a cada 5min de gravação):
  ffmpeg -i recording.ts \
    -vf "fps=1/5,scale=160:90,tile=12x10" \
    sprite-{hour}.jpg          # 1 frame a cada 5s, grid 12×10 = 120 frames

Box → Cloud (POST /sprites):
  PUT R2: integrador/{integradorId}/cameras/{cameraId}/{day}/{hour}.jpg
  POST /sprites: { cameraId, day, hour, frameIntervalSec: 5, gridCols: 12, gridRows: 10 }

Cloud (GET /playback/:cameraId/sprites?day=YYYY-MM-DD):
  Retorna lista de SpriteManifest por hora:
    [
      { hour: 14, url: "https://r2/.../14.jpg", frameInterval: 5, cols: 12, rows: 10 },
      { hour: 15, url: "https://r2/.../15.jpg", ... },
      ...
    ]

Frontend (PlaybackTimelineZoom):
  - useSWR('/playback/:cameraId/sprites?day=...') — pré-carrega manifests
  - Durante hover: calcula hour=floor(sec/3600), frameIdx=floor((sec%3600)/5)
  - Renderiza <div style="background-image: url(sprites[hour].url);
    background-position: -{(frameIdx%cols)*160}px -{floor(frameIdx/cols)*90}px;
    width: 160px; height: 90px;" />
  - Posicionada acima da linha-guia (top: -100px se houver espaço, senão
    abaixo da timeline pra não vazar).
```

### Esforço

| Frente | Tempo | Quem |
|---|---|---|
| Box: ffmpeg pipeline + upload | 1.5d | Box team (bridge) |
| Cloud: POST /sprites + R2 + GET /playback/sprites | 1d | Cloud (Tarcísio) |
| Cloud: backfill de sprites pra gravações antigas (opcional) | 0.5d | Cloud |
| Frontend: hook + render + posicionamento | 1d | Cloud |
| Storage R2: ~40MB/cam/dia (160×90 jpg quality 70, 12×10 grid × 24h) | — | — |
| **Total** | **~4d (+ Box em paralelo)** | |

### Dependências

- **BLOQUEADO** até Box gerar sprite-sheets. Tarefa pra próxima rodada da bridge.
- Box já tem ffmpeg no pipeline (gera os .ts de gravação) — adicionar passo paralelo.

### Critérios de pronto

- [ ] Box upload de sprite por hora cobre 100% das horas com gravação
- [ ] Manifest GET retorna < 200ms (R2 cache hit)
- [ ] Hover preview renderiza < 50ms (sprite já em cache do browser)
- [ ] Fallback gracioso quando não há sprite (não quebra hover atual)
- [ ] Storage budget validado: < 1GB/cam/mês com retenção 30d

### Quando fazer

- **Após bridge entregar sprite generation** OR
- **Quando primeiro cliente pedir** (alta probabilidade — todos os concorrentes têm)

---

## Item 2 — Multi-camera sync (mosaico de playback)

### O que é

Reproduzir **N câmeras simultaneamente** com timeline única — um único cursor
controla todas. Útil pra revisão forense: "o que cada câmera viu às 03:42?"
sem precisar abrir N abas e sincronizar manualmente.

### Por que importa

**Caso de uso forense é o coração de VMS B2B.** Sem isso, operador investiga
incidentes navegando câmera por câmera, comparando relógios visualmente —
processo lento e propenso a erro. Concorrentes (Digifort, Defense IA, Milestone)
têm como feature core.

### Arquitetura proposta

**Frontend orquestra; backend não muda.** Reusa `PlaybackPlayer` (que já
expõe `seekTo(secOfDay)` via ref) e `PlaybackTimelineZoom` (já recebe
callbacks de seek).

```
RecordingsMultiPage (nova rota /recordings/multi):
  - Sidebar: lista de câmeras com checkbox (até 9 selecionáveis)
  - Layout: grid 1×1 / 2×2 / 3×3 (auto pelo # cameras selecionadas)
  - Tile = <PlaybackPlayer minimal autoPlay={false} ref={tileRef[i]}>
  - Timeline única em baixo: <PlaybackTimelineZoom> recebe `mergedBitmap`
    (OR de todos bitmaps das câmeras) + `currentSecOfDay`
  - Estado central: { currentSecOfDay, playing, rate }
  - onSeek(sec): for (ref of tileRefs) ref.seekTo(sec)
  - onPlayPause: for (ref of tileRefs) ref.togglePlay()
  - onRate(r): for (ref of tileRefs) ref.setRate(r)

Drift correction:
  - A cada 5s, lê secOfDay de cada tile via onTimeUpdate.
  - Se max-min > 1s, força seekTo(currentSecOfDay) em todas (re-sync).
  - Causa: HLS de cada câmera carrega independente, drift natural.

Bitmap merge:
  - Backend já retorna bitmap por câmera.
  - Frontend faz OR bit-a-bit: mergedBitmap[i] = '1' se ANY camera bitmap[i]='1'
  - Heatmap intensity = sum por camera (mais cameras gravando = mais intenso)
```

### Esforço

| Frente | Tempo |
|---|---|
| RecordingsMultiPage layout + grid responsivo | 1.5d |
| Sync de seek/play/rate via refs (já existem) | 1d |
| Drift correction (timer + re-seek) | 1d |
| Bitmap merge + heatmap multi-cam | 0.5d |
| Performance: testar com 9 câmeras simultâneas (rede, CPU) | 1d |
| Tab navigation no router | 0.5d |
| **Total** | **~5.5d** |

### Dependências

- Nenhuma técnica — toda infra já existe.
- **Hardware/rede do cliente**: 9 streams HLS = ~9 × 2Mbps = 18Mbps download
  sustentado. Validar com piloto antes de cobrar como feature ENTERPRISE.

### Critérios de pronto

- [ ] 4 câmeras simultâneas com drift < 1s sustentado por 30min
- [ ] Seek único move todas (latência < 500ms p95)
- [ ] Play/pause sincronizado
- [ ] Rate (0.5×→4×) aplicado em todas
- [ ] Layout adapta a 1/2/3/4/6/9 câmeras
- [ ] Erro em 1 câmera não derruba as outras

### Quando fazer

- **Logo após sprite preview** — esses dois juntos posicionam o produto
  na faixa "VMS forense profissional".
- **Pricing ENTERPRISE-only** (>9 câmeras simultâneas é caso de operador
  de monitoramento, não cliente final).

---

## Item 3 — Busca forense semântica

### O que é

Operador escreve em linguagem natural ("homem com mochila vermelha entrando
às 02:00") e o sistema retorna **clipes relevantes** com timestamp + thumbnail.

Não é OCR/reconhecimento facial — é busca por **embedding visual + texto**
sobre frames extraídos. Tecnicamente: CLIP-style model converte cada frame
em vetor 512-dim, query texto também vira vetor, cosine similarity ranqueia.

### Por que importa

**Diferenciação radical no mercado BR.** Hoje, busca forense em VMS BR é
filtro por timestamp + tipo de evento (motion, person, vehicle). Busca
semântica é estado-da-arte (Verkada Command, Eagle Eye Cloud) e nenhum
concorrente brasileiro tem.

**Mas é caro de fazer e operar.** Por isso parqueado.

### Arquitetura proposta

**3 componentes pesados:**

#### 3a. Pipeline de extração de frames

```
Box (ou Cloud worker — depende de onde tem GPU):
  Para cada segment .ts gravado:
    ffmpeg -i seg.ts -vf "fps=1/2" frames-{n}.jpg   # 1 frame a cada 2s
  Para cada frame:
    embedding = CLIP_model.encode_image(frame)      # 512-dim float32
    POST /forensic/index { cameraId, sec, embedding, frameUrl }
```

#### 3b. Storage + busca

```
PostgreSQL com pgvector extension:
  CREATE TABLE forensic_frame (
    id UUID PRIMARY KEY,
    camera_id UUID NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    embedding vector(512) NOT NULL,
    frame_url TEXT NOT NULL,         -- R2 thumb
    tenant_id TEXT NOT NULL,
    INDEX (tenant_id, camera_id, captured_at),
    INDEX USING ivfflat (embedding vector_cosine_ops)
  );

  Query:
    SELECT camera_id, captured_at, frame_url,
           1 - (embedding <=> $1) AS score
    FROM forensic_frame
    WHERE tenant_id = $2
      AND captured_at BETWEEN $3 AND $4
    ORDER BY embedding <=> $1
    LIMIT 50;
```

#### 3c. UI de busca

```
Frontend (/forensic-search):
  - Input texto: "homem mochila vermelha 02:00"
  - Filtros: câmera(s), range de datas
  - Submit → POST /forensic/search { query, cameraIds, from, to }
  - Backend: encode_text(query) → query embedding → pgvector search
  - Resultados: thumbnails ordenados por score, click → playback no instante
```

### Esforço

| Frente | Tempo | Custo recorrente |
|---|---|---|
| Pipeline extração (ffmpeg + CLIP inference) | 5d | GPU $50-200/mês inicial |
| pgvector setup + schema + migrations | 1d | DB grows ~50MB/cam/mês |
| API /forensic/index + /forensic/search | 2d | — |
| UI de busca (página nova) | 3d | — |
| Backfill de gravações antigas (opcional) | 2d | — |
| Performance tuning (ivfflat lists, query optimization) | 2d | — |
| Validação: testes com queries reais em 30d de gravação real | 3d | — |
| **Total** | **~18d (~3.5 semanas)** | **~$200/mês** |

### Dependências

- **GPU pra inferência CLIP** — Hetzner não oferece GPU em VPS standard.
  Opções: AWS spot ($0.50/h on-demand), Lambda Labs, RunPod. Ou rodar CLIP-tiny
  no CPU (3x mais lento, mas viável pra <50 câmeras).
- **pgvector extension** no Postgres — disponível, sem mudanças destrutivas.
- **CLIP model**: open weight (LAION CLIP-ViT-B-32 ou similar). Sem custo
  de API.

### Critérios de pronto

- [ ] Indexação live: lag < 5min entre frame gravado e indexado
- [ ] Query latência p95 < 1s para 1M frames indexados
- [ ] Recall em queries de teste validadas (precisa criar ground truth)
- [ ] Custo storage validado: < R$10/cam/mês para 30d de retenção
- [ ] Privacidade: tenant_id estritamente respeitado (LGPD compliance)

### Quando fazer

- **Onda 3+ do roadmap** — feature de diferenciação, não MVP.
- **Pré-requisitos**: 10+ clientes ativos com volume de gravação que
  justifique investimento em GPU.
- **Cuidado regulatório**: facial recognition é restrito por LGPD em
  alguns contextos. CLIP busca por descrição visual (não identifica
  pessoas), mas se evoluir pra face search precisa pareceres jurídicos.

---

## Resumo executivo

| Item | Esforço | Dependência crítica | Quando fazer |
|---|---|---|---|
| **Sprite preview** | ~4d | Box gerar sprites | Próxima bridge |
| **Multi-camera sync** | ~5.5d | Nenhuma técnica | Pós-sprite OR demanda piloto |
| **Busca semântica** | ~18d + GPU $200/mês | pgvector + GPU + 10+ clientes | Onda 3 (9-12 meses) |

**Recomendação**: aceitar todos os 3 como **backlog formal** mas não puxar
até gatilho concreto (bridge entrega sprites / cliente pede multi-cam /
volume justifica busca semântica). O produto atual já está competitivo
com o nacional — não precisa empurrar essas features pra MVP.
