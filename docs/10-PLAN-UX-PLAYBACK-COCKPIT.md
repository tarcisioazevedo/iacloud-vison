# Plano UX — Playback Cockpit

**Data:** 2026-05-08
**Status:** Proposta para aprovação
**Tipo:** Redesign de UX de revisão de gravações
**Branch alvo:** `dev` (após aprovação)

---

## 1. Diagnóstico do estado atual

Olhando a tela de `/recordings` num laptop padrão (1366×768) e até em monitor 1920×1080:

| Sintoma | Causa |
|---|---|
| Vídeo aparece **cortado** ou pequeno | Hero ocupa ~150px, tabs + filtros + day picker ~140px, sobram ~470px pro vídeo+timeline em 1080p, ~340px em laptop |
| Sidebar fixa **rouba largura** mesmo com 1 câmera | `lg:col-span-1` reserva 25% mesmo quando lista tem 1 item |
| Filtros de hora **ocupam linha inteira** sempre visíveis | "Atalhos rápidos" + inputs de tempo + label "limpar" — bloco de 60px sempre presente |
| Botão "Ao Vivo" e Tabs ficam ABAIXO do hero | Empilha mais 50px de chrome |
| Sem **tela cheia** ou **modo cinema** | Operador forensico precisa ver detalhes — hoje vê ~300px de vídeo real |
| Timeline + filtro de hora UTC + dia + Tab + Hero = 5 sub-cabeçalhos | Overload visual; pra cada interação operador percorre meio metro de tela |

**Resultado**: revisão de gravação é **a tarefa mais importante** desse produto, mas tem o **pior aproveitamento de viewport** entre todas as páginas.

---

## 2. Princípios do redesign

1. **O vídeo é o protagonista**. Tudo que não for vídeo precisa justificar pixel.
2. **Densidade alta — operador é profissional**. Sem "vazio decorativo"; controles compactos como Frigate/Premiere/DaVinci.
3. **Estados auto-ajustáveis**. Sidebar retrátil, filtros recolhíveis, cinema mode, fullscreen.
4. **Atalhos de teclado pesados**. Operador trabalha 8h/dia — mouse é fricção.
5. **Persistência inteligente**. Estado da sidebar/filtros lembra entre sessões.
6. **Responsividade real**. Funciona de mobile a 4K sem esconder funcionalidade.

---

## 3. Layout proposto — Modo padrão

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║  ⚡ IA Cloud Vision    🔍 Buscar...                              ⚠️99+ 📥 SA Super  ║  ← topbar global (existe)
╠══════════════════════════════════════════════════════════════════════════════════╣
║                                                                                  ║
║  🎬 Gravações  ◐ Playback ▾  📅 08/05 · Dia inteiro ▼  ⏱111min(7.7%) ⚠6 gaps ◀▶ ║  ← BARRA UNIFICADA (40px)
║                                                                                  ║
║┌────┐ ┌────────────────────────────────────────────────────────────────────────┐║
║│ ≡  │ │                                                                        │║
║│    │ │                                                                        │║
║│ 🎥 │ │                                                                        │║
║│cam1│ │                                                                        │║
║│ ●  │ │                          PLAYER  (cresce até 65vh)                     │║
║│    │ │                                                                        │║
║│ +  │ │                                                                        │║
║│    │ │                                                                        │║
║│    │ │                                                                        │║
║│    │ │                                                                        │║
║│    │ │ [📷] [✂️] [⭐ B] [🔗] [⛶ F]   05:39:36 / 23:59:59      [▶] [1×▾] [🔊]  │║  ← toolbar contextual (32px)
║│    │ ├────────────────────────────────────────────────────────────────────────┤║
║│    │ │ ┃▓▓▓▓▒▒░░░░░░░░░░░░░░░░░░░░░░░│▓▓▓▓▓▓▓▓░░░░░░░░░░│▓▓▓░░░░░░░░░░░│░░│ │║  ← timeline (64px)
║│    │ │   00:00      03:00      06:00       09:00     12:00       15:00       │║
║└────┘ └────────────────────────────────────────────────────────────────────────┘║
║   ↑ sidebar colapsada                                                            ║
║   (40px, só ícones)                                                              ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

### O que muda

| Antes | Depois |
|---|---|
| Hero `PremiumHero` com 4 linhas (~150px) | Barra única de 40px com breadcrumb + tab + filtro condensado + stats |
| Tabs verticais (Playback/Status/Storage/Config) | Dropdown `◐ Playback ▾` na barra (mais visões aparecem só quando preciso) |
| Day picker + filtro hora em GlassCards separados | Chip `📅 08/05 · Dia inteiro ▼` que expande inline drawer |
| Sidebar 25% fixa | Sidebar 280px aberta / 40px colapsada (toggle `[`) |
| Sem ações rápidas | Toolbar contextual acima da timeline com snapshot/exportar/bookmark/share/fullscreen |
| Sem tela cheia | Botão `⛶ F` + atalho `F` |

### Sidebar retrátil — detalhes

**Aberta (280px):**
```
┌──────────────────────────┐
│ 🔍 Buscar câmera...      │
│ ─────────────────────    │
│ Todos os sites      ▼    │
│ 1 câmera com gravação    │
├──────────────────────────┤
│ ┌──────────────────────┐ │
│ │ 🎥 camera1        ●  │ │
│ │ Laboratório Principal│ │
│ │ 7d · MOTION          │ │
│ └──────────────────────┘ │
│                          │
│ + Adicionar câmera       │
└──────────────────────────┘
```

**Colapsada (40px):**
```
┌────┐
│ ≡  │ ← toggle
├────┤
│ 🔍 │ ← atalho `/`
├────┤
│ ●  │ ← cam1 (hover: tooltip nome+site)
│cam1│
├────┤
│ +  │
└────┘
```

- **Atalho `[`** alterna estado
- **localStorage** lembra preferência por usuário
- **Auto-colapsa** abaixo de 1024px (responsividade)

---

## 4. Layout proposto — Modo Cinema

Atalho **`C`** ou click duplo no vídeo. Foco total na imagem; controles flutuam sobre o vídeo só quando o mouse está perto.

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║                                                                                  ║
║                                                                                  ║
║                                                                                  ║
║                                                                                  ║
║                          PLAYER  (90vh)                                          ║
║                                                                                  ║
║                                                                                  ║
║                                                                                  ║
║                                                                                  ║
║                                                                                  ║
║   ┌────────────────────────────────────────────────────────────────────────────┐ ║
║   │ ▓▓▓▓▒▒░░░░░░░░░│▓▓▓▓▓▓░░░░░░│▓▓▓░░░░░░░│░░░          ← timeline overlay   │ ║
║   │ 05:39:36 / 23:59:59     [📷][⭐][⛶][⏏ESC]                                  │ ║
║   └────────────────────────────────────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

- Sidebar, header, filtros: TODOS recolhidos
- Timeline + toolbar viram **overlay flutuante** no rodapé (auto-hide após 3s sem mouse)
- `ESC` ou `C` volta ao modo padrão

### Modo Theater (fullscreen real do browser)

Atalho **`F`**. Mesma timeline overlay, mas o browser entra em fullscreen API. Ideal pra TV de monitoramento.

---

## 5. Filtros condensados (chip → drawer)

**Chip fechado (default):**
```
📅 08/05/2026 · Dia inteiro · 1 câmera ▼
```

**Chip clicado → drawer expande inline (sem modal):**
```
┌─────────────────────────────────────────────────────────────────┐
│ ◀ 08/05/2026 ▶  [Hoje]    Hora UTC: 00:00 → 23:59  [limpar]    │
│                                                                 │
│ [Dia inteiro] [Manhã] [Tarde] [Noite] [Última hora]            │
│                                                                 │
│ Câmera: camera1 ▾   Site: Laboratório Principal ▾              │
└─────────────────────────────────────────────────────────────────┘
```

- Recolhe sozinho 5s após qualquer mudança
- Guarda último filtro em `sessionStorage` (resetar = recarregar página)

---

## 6. Toolbar contextual acima da timeline

Linha de 32px com info + ações rápidas:

```
[📷 Snapshot]  [✂️ Exportar clip]  [⭐ Bookmark agora]  [🔗 Copiar link timestamp]  [⛶ Cinema F]
─────────────────────────────────────────────────────────────────────────────────────────────
 05:39:36 / 23:59:59       [⏪10] [▶/⏸] [⏩10]    [1×▾]      [🔊]      111min · 7.7% · ⚠6
```

| Ação | Atalho | O que faz |
|---|---|---|
| Snapshot | `S` | Baixa frame atual como JPG (`canvas.toBlob`) |
| Exportar clip | `E` | Modal pede `from`→`to`, gera POST `/playback/export` (já existe?) |
| Bookmark agora | `B` | Cria bookmark no `currentSecOfDay` (modal mínimo) |
| Copiar link | `Shift+L` | URL `?cam=...&day=...&at=05:39:36` no clipboard |
| Cinema | `C` | Toggle modo cinema |
| Fullscreen | `F` | Toggle browser fullscreen |

---

## 7. Atalhos de teclado completos

| Atalho | Ação |
|---|---|
| **Espaço** | Play / Pause |
| **←** / **→** | -5s / +5s |
| **Shift+←** / **Shift+→** | -30s / +30s |
| **↑** / **↓** | Velocidade (1× → 2× → 4× → 0.5×) |
| **Home** / **End** | Início / fim do dia |
| **0-9** | Pula pra 0% / 10% / ... / 90% do dia |
| **F** | Fullscreen |
| **C** | Cinema mode |
| **B** | Bookmark no instante atual |
| **S** | Snapshot |
| **E** | Exportar clip |
| **[** | Toggle sidebar |
| **/** | Foco no campo de busca |
| **?** | Abre modal de atalhos (cheatsheet) |
| **Esc** | Sai de cinema/fullscreen/modal |

---

## 8. Responsividade real

| Breakpoint | Comportamento |
|---|---|
| **≥ 1536px** (4K, ultrawide) | Sidebar 280 + main + painel direito opcional (eventos/bookmarks list) |
| **1024-1535** (desktop padrão) | Sidebar 280 + main; painel direito recolhido por default |
| **768-1023** (tablet) | Sidebar **drawer overlay** (não rouba layout); main 100% |
| **< 768** (mobile) | Stacked: header → vídeo → timeline → drawer button pra câmeras |

**Em qualquer tela, o vídeo cresce até 65vh** (com aspect-ratio respeitado). Em telas ≥1280, **modo cinema chega a 90vh**.

---

## 9. Tipografia + cores (mantém o existente)

Sem mudar a paleta atual (slate dark + cyan + amber). Só normalizar:
- Header chip: `text-xs font-mono` (era `text-sm`)
- Stats badges: `text-[10px]` em fundo neutro
- Timeline labels: `text-[9px]` (já é)

---

## 10. Esforço estimado

| Frente | Tempo | Risco |
|---|---|---|
| Refactor RecordingsPage layout (header chip, grid responsivo) | 2d | Baixo |
| Sidebar retrátil + persistência | 0.5d | Baixo |
| Filtros chip+drawer | 0.5d | Baixo |
| Toolbar contextual + 5 ações rápidas | 1.5d | Médio (snapshot/exportar/share — verificar API existe) |
| Cinema mode + fullscreen + atalhos | 1d | Baixo |
| Responsividade real (mobile/tablet) | 0.5d | Baixo |
| QA + persistência localStorage + cheatsheet | 0.5d | Baixo |
| **Total** | **~6d** | |

---

## 11. Métricas de sucesso

- **Espaço útil pro vídeo aumenta de ~40% pra ~75%** do viewport em laptop padrão
- Operador chega ao vídeo em **0 cliques** (entra pelo /recordings já vê reproduzindo do último ponto)
- Tarefas comuns (mudar dia, filtrar hora, criar bookmark) custam **1 click** ou **1 atalho**
- Suporta de **iPhone SE (375px)** a **monitor 4K (3840px)** sem regressões

---

## 12. Aprovação solicitada

Antes de codar, confirmar:

- [ ] Layout proposto faz sentido? (Hero compacto + sidebar retrátil + cinema mode)
- [ ] **Modo cinema** tem prioridade ou só padrão+fullscreen é suficiente?
- [ ] Toolbar contextual: quais 5 ações são realmente necessárias agora?
  - 🟢 Snapshot, Bookmark, Cinema, Fullscreen
  - 🟡 Exportar clip — depende de endpoint
  - 🟡 Copiar link timestamp — fácil mas opcional
- [ ] Painel direito de eventos/bookmarks (só ≥1536px) — desejável ou exagero?
- [ ] Atalhos de teclado: cheatsheet com `?` é suficiente?

Aprovado, codo em ordem: **layout base → sidebar → filtros chip → toolbar → cinema → atalhos → responsividade**.
