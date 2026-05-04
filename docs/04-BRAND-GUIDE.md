# IA Cloud Vision — Brand Guide

> Aplicar em **Cloud (vsaas-frontend)** e **Box (web UI)**. Usar os assets de `vsaas-frontend/public/brand/` (espelhados em `INTEGRATION/brand/` para a Box consumir).

## Identidade

- **Nome do produto:** IA Cloud Vision
- **Tagline:** A Inteligência que faltava no seu CFTV
- **Símbolo:** nuvem azul contendo um olho com mesh de rede (representa visão computacional + cloud + nós distribuídos)
- **Tom:** técnico, confiável, brasileiro. Sem jargão americanizado. Sem "AI-powered", usar "com IA".

## Logo (assets)

| Arquivo | Uso |
|---|---|
| `brand/logo-full.svg` | Header de marketing, login, README, e-mail |
| `brand/logo-mark.svg` | Sidebar colapsada, app bar, OG image |
| `brand/favicon.svg` | favicon, manifest, PWA tile |
| `brand/logo-iacloud-vision.png` | versão raster oficial (entregue por Tarcísio — substitui placeholders) |

**Regras:**
- Margem de respiro mínima: altura do "I" de "IA" em todos os lados
- Nunca girar, distorcer, recolorir o símbolo, ou separar mark+wordmark com menos respiro que o original
- Sobre fundo escuro: usar `logo-mark.svg` com tag `<style>.cloud{filter:brightness(1.1)}</style>` ou versão monocromática branca (a criar quando demandar)

## Paleta — CSS Variables

```css
:root {
  /* Primárias — azuis da marca */
  --brand-cyan-300:  #7CC0F0;  /* nuvem topo, hover light */
  --brand-blue-500:  #3B82F6;  /* "Cloud", "VISION", links */
  --brand-blue-700:  #1E3A8A;  /* "IA", iris escura */
  --brand-navy-900:  #0F172A;  /* fundo escuro, texto principal */

  /* Suporte — neutros */
  --neutral-50:      #F8FAFC;  /* fundo light app */
  --neutral-200:     #E2E8F0;  /* divisórias */
  --neutral-500:     #64748B;  /* tagline, texto auxiliar */
  --neutral-700:     #334155;  /* texto secundário */

  /* Semânticos */
  --success:         #16A34A;
  --warning:         #F59E0B;
  --danger:          #DC2626;
  --info:            #06B6D4;
}
```

## Gradient principal (logo + acentos)

```css
background: linear-gradient(180deg, #7CC0F0 0%, #3B82F6 100%);
```

Aplicar em: nuvem do logo, botões CTA primários (sutil), bordas de cards "premium".

## Tipografia

- **Display / wordmark:** **Inter** (800 para "IA"/"Cloud", 600 para "VISION") — Geist Sans como fallback
- **Body:** **Inter** 400/500
- **Mono (logs, IDs, code):** **JetBrains Mono** ou **Geist Mono**

```css
font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
font-family: 'JetBrains Mono', 'Geist Mono', ui-monospace, monospace; /* mono */
```

**Hierarquia (Tailwind-ready):**
- `text-3xl font-extrabold tracking-tight` — page title
- `text-xl font-semibold` — section
- `text-base` — body
- `text-sm text-neutral-500` — helper
- `text-xs font-mono` — IDs, timestamps

## Aplicação por superfície

### Cloud (vsaas-frontend)
- Sidebar collapsed: `logo-mark.svg` (32×32)
- Sidebar expanded: `logo-full.svg` altura 36
- LoginPage: `logo-full.svg` centralizado, max-width 320
- Footer: `IA Cloud Vision · v<X.Y.Z> · suporte@iacloud.com.br`

### Box (web UI)
- Header: `logo-mark.svg` + "Box" badge
- LoginPage / first-boot: `logo-full.svg` + tagline
- Footer (já implementado pela Box no Sprint 1-C): manter

### E-mails / documentos
- Cabeçalho: `logo-full.svg` (raster PNG 240px wide se cliente bloquear SVG)
- Assinatura: "Equipe IA Cloud Vision"

## Don'ts

- ❌ Não chamar de "ICV" em UI voltada ao cliente (interno only — código, logs, env vars `ICV_*`)
- ❌ Não usar verde/laranja/roxo como cor primária — fora da paleta
- ❌ Não traduzir tagline ("A Inteligência que faltava no seu CFTV" é fixa pt-BR; mercado é Brasil)
- ❌ Não usar "AI" no UI brasileiro — sempre "IA"

## Versionamento

Toda alteração no logo/paleta:
1. Atualizar `vsaas-frontend/public/brand/`
2. Espelhar em `INTEGRATION/brand/`
3. Bump em `INTEGRATION/CHANGELOG.md` linha `[CLOUD] brand v<X.Y>`
4. Avisar Box via `INTEGRATION/CLOUD_TO_BOX.md`

---

**Última revisão:** 2026-05-04 — placeholders SVG entregues, aguardando PNG oficial em `vsaas-frontend/public/brand/logo-iacloud-vision.png`.
