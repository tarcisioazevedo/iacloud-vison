# TDD Playbook — VSaaS

Manual operacional do **Test-Driven Development** no VSaaS, iniciado em
Sprint γ-Day1 (2026-05-12). Estrategicamente integrado ao código legado
via **extract-to-lib + characterization tests** (sem reescrever
universo).

---

## 1. Por que TDD agora

O sistema hoje tem 3 tipos de teste:

1. **Manual end-to-end** — dev abrir UI, clicar, observar. Caro, frágil, não escala.
2. **Logs em produção** — descobre bug depois que cliente reclamou.
3. **`tenant-scope.spec.ts`** — único spec unit existente. Bom, mas isolado.

**Custo de cada bug em produção** (ISP B2B2B vendendo SaaS):
- Ticket suporte: 30min × R$80/h = **R$40**
- Confiança erodida: 1 cliente WTF/mês = **R$1k/ano** churn risk
- Tempo de dev pra debugar/fixar: 2h × R$200/h = **R$400**

10 bugs/mês evitados via TDD = ~R$5k/mês de economia direta + churn evitado.

---

## 2. Workflow Red-Green-Refactor

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   1. RED       Escreve teste que falha                           │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   2. GREEN     Implementa mínimo pra teste passar                │
│                                                                  │
│   ─────────────────────────────────────────────────────────────  │
│                                                                  │
│   3. REFACTOR  Limpa, extrai duplicação, melhora nomes           │
│                Testes continuam verdes                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Exemplo prático — Clock skew defense (commit do dia γ)

**Step 1 (RED):** spec falhando

```ts
// src/lib/clock-skew.spec.ts
it('rejeita ISO string inválido', () => {
  expect(classifyClockSkew('not-a-date', 6, NOW_MS).kind).toBe('reject')
})
```

Roda: `npx vitest run src/lib/clock-skew.spec.ts` → ❌ `classifyClockSkew is not defined`.

**Step 2 (GREEN):** mínimo pra passar

```ts
// src/lib/clock-skew.ts
export function classifyClockSkew(iso, dur, now) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return { kind: 'reject', reasonSec: 0 }
  return { kind: 'ok', normalized: d }
}
```

Roda novamente → ✅ verde. Vai pro próximo caso.

**Step 3 (REFACTOR):** depois de todos verdes, refactor — extrai constantes, simplifica, JSDoc.

---

## 3. Pirâmide de testes

```
                     ╱╲
                    ╱  ╲          E2E (~5%)
                   ╱────╲           Playwright UI flows
                  ╱      ╲          velocidade lenta, alto valor
                 ╱────────╲
                ╱          ╲       Integration (~15%)
               ╱────────────╲        supertest API + testcontainer Postgres
              ╱  Component   ╲      ~30%
             ╱  (UI primitive)╲       Vitest + React Testing Library + axe
            ╱──────────────────╲
           ╱                    ╲   Unit (~50%)
          ╱──────  PURE  ────────╲    Vitest funções puras
         ╱      FUNCTIONS         ╲   velocidade <1s, cobertura alta
        ╱──────────────────────────╲
```

### Onde cada teste vive

| Tipo | Localização | Quando rodar |
|---|---|---|
| **Unit** | `src/**/<arquivo>.spec.ts` co-localizado | pre-commit (related), CI sempre |
| **Integration** | `qa/integration/*.test.ts` (futuro) | CI sempre |
| **Component** | `vsaas-frontend/src/**/<Comp>.spec.tsx` | pre-commit (related), CI sempre |
| **E2E** | `qa/e2e/*.spec.ts` (Playwright) | CI nightly + pre-release |
| **Property-based** | dentro do unit, via `fc.assert(...)` | pre-commit (related) |

---

## 4. Coverage targets

Hoje (baseline pós-γ-Day1):

```
Backend:
  src/lib/clock-skew.ts        100% (TDD-built)
  src/lib/rtmp-key.ts          100%
  src/lib/seg-timestamp.ts     100%
  src/lib/tenant-scope.ts      ~95%  (pre-existing)
  src/routes/iacv-box-segments.ts (detectSegmentFormat) ~30% (só esta função)
  ─────────────────────────────
  Total backend                ~5%   (sobe à medida que extraímos)
```

### Targets evolutivos

| Semana | Backend Lines% | Frontend Lines% | Notas |
|---|---|---|---|
| Hoje | 5% | 0% | sprint γ-Day1 |
| W+2 | 25% | 15% | mais funções extraídas |
| W+4 | 50% | 40% | components testados |
| W+8 | 70% | 60% | API supertest cobre routes |
| W+12 | 80% | 70% | mutation score >70% |

**Coverage gate no CI:** PR não merge se cobertura do **arquivo modificado** cair >5 pontos.

---

## 5. Padrões pra escrever testes

### Padrão A — Função pura

```ts
import { describe, it, expect } from 'vitest'

describe('classifyClockSkew', () => {
  // 1. Casos felizes (3-5 testes)
  it('aceita ±5min sem warning', () => { ... })

  // 2. Casos de borda (boundary)
  it('boundary: exato 5min é ok', () => { ... })
  it('boundary: 5min+1ms é reject', () => { ... })

  // 3. Casos de erro
  it('rejeita ISO inválido', () => { ... })

  // 4. Property-based (uma vez por função importante)
  it('property: rewritten sempre = now - duration', () => {
    fc.assert(fc.property(fc.integer({min: 900_001, max: 86400_000}), ...))
  })
})
```

### Padrão B — Service com Prisma (mock)

```ts
import { vi } from 'vitest'

vi.mock('./prisma', () => ({
  prisma: {
    camera: {
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
  },
}))

import { prisma } from './prisma'
import { startRecording } from './cloud-direct-recorder'

it('reserva slot active antes de awaits longos (race condition fix)', async () => {
  // Setup: simula resolveIntegradorId demorando 500ms
  ;(prisma.camera.findUnique as any).mockImplementation(
    () => new Promise(r => setTimeout(() => r({ ... }), 500)),
  )

  // Race: duas chamadas concorrentes
  const [a, b] = await Promise.all([
    startRecording('cam1', 'key1', 'int1'),
    startRecording('cam1', 'key1', 'int1'),
  ])

  // Assert: apenas 1 spawn de ffmpeg
  expect(spawnSpy).toHaveBeenCalledTimes(1)
})
```

### Padrão C — Component React (RTL)

```tsx
import { render, screen } from '@testing-library/react'
import { PlaybackPlayer } from './PlaybackPlayer'

it('mostra "Câmera em ERRO" quando emptyStateContext.cameraStatus=ERROR', () => {
  render(
    <PlaybackPlayer
      cameraId="x" fromIso="..." toIso="..."
      emptyStateContext={{ cameraStatus: 'ERROR', lastSegmentAt: '...' }}
    />
  )
  // Trigger error state (simulate hls.js levelEmptyError)
  ...
  expect(screen.getByText(/Câmera em ERRO/i)).toBeInTheDocument()
})
```

---

## 6. Estratégia de extração pra código legado

Não dá pra escrever 500 unit tests retroativos. Estratégia gradual:

### Etapa 1 — Identificar **smells de testabilidade**

```bash
# Funções com mais de 50 linhas, ifs aninhados, IO+lógica misturados
grep -rn "function " src/ | xargs wc -l | sort -rn | head
```

### Etapa 2 — **Extract-to-lib**

Função inline em route/service → move pra `lib/`:

```ts
// ANTES — em routes/iacv-box-segments.ts
function validateAndNormalizeStartedAt(...) {  // 50 linhas, testa-se via curl
  ...
}

// DEPOIS — em lib/clock-skew.ts (puro)
export function classifyClockSkew(...): ClockSkewResult { ... }

// E em routes/iacv-box-segments.ts (wiring)
function validateAndNormalizeStartedAt(...) {
  const r = classifyClockSkew(...)
  if (r.kind === 'reject') throw new ValidationError(...)
  ...
}
```

Roda os testes unit no `lib/`. Wiring continua igual, mas a lógica nervosa fica isolada.

### Etapa 3 — **Characterization tests** primeiro

Quando precisar mexer em código legado complexo (ex: `buildManifest`):

```ts
// Captura comportamento ATUAL, mesmo que com bugs
it('characterization: buildManifest output snapshot pra range fixo', async () => {
  const ticket = { cameraId: 'fixed', fromMs: 1700000000000, toMs: 1700003600000, ... }
  const manifest = await playbackService.buildManifest(ticket, 'http://localhost')
  expect(manifest).toMatchSnapshot()
})
```

Depois mexe no código — qualquer mudança comportamental quebra o snapshot, força revisão consciente.

### Etapa 4 — **Test-induced refactoring**

Toda vez que escrever um teste novo:
- Difícil mockar? → Injeção de dependência
- Função muito grande? → Extrair sub-funções
- IO misturado? → Separar pure logic do IO

---

## 7. Ferramental

```
Vitest 2.x          test runner (já instalado backend)
fast-check          property-based testing (já disponível, transitive)
@testing-library/   component tests frontend (a instalar)
  react             RTL para React
axe-core            accessibility tests (a instalar)
Playwright          E2E flows (a instalar)
Stryker             mutation testing (a instalar — mensal)
jest-mock-extended  type-safe Prisma mocks (a instalar)
supertest           HTTP integration tests (a instalar)
```

---

## 8. Pre-commit hook estendido

```bash
# .git/hooks/pre-commit (via scripts/git-hooks/install.sh)
1. gitleaks scan staged             (já existe)
2. tsc --noEmit                     ← NOVO (catch type errors antes de PR)
3. vitest run --changed             ← NOVO (só testes afetados)
4. prettier --check (opcional)
```

**Tempo total esperado:** <10s pra commit típico.

---

## 9. CI Pipeline (GitHub Actions / GitLab CI)

```yaml
# pre-merge.yaml — bloqueia merge se quebrar
jobs:
  unit-and-component:
    runs-on: ubuntu-latest
    steps:
      - run: npm test                       # vitest run (todos)
      - run: npm run test:coverage          # gate ≥ target diff
      - run: npm run test:type-check        # tsc --noEmit

  e2e-smoke:
    services:
      postgres: { image: postgres:16-alpine }
    steps:
      - run: npm run test:e2e -- --grep 'smoke'  # ~5min

  regression:
    steps:
      - run: bash qa/regression/run-all.sh  # 12 bug-blindar scripts

# nightly.yaml — ambiente staging
jobs:
  full-suite:
    steps:
      - run: npm run test:e2e
      - run: npm run test:perf
      - run: npm run test:chaos
      - run: npm run test:mutation -- --threshold 70  # weekly only
```

---

## 10. FAQs do dev solo (você)

**Q: Tenho que escrever teste pra TODA função?**
A: Não. Foco em **funções puras com lógica de negócio** + **funções que já causaram bug**. Helpers triviais (`formatBytes`) podem pular.

**Q: TDD não me deixa mais lento?**
A: Primeira semana sim (~20% slower). Da segunda em diante, **mais rápido** porque debug some.

**Q: E o código legado sem testes?**
A: Não escreve teste pra tudo. Estratégia: **NOVA feature = TDD obrigatório**. **Bug em legacy = escreve teste que reproduz, depois fixa**.

**Q: Property-based vs example-based?**
A: Example pra explicar o que faz. Property pra blindar invariantes (`x.round-trip(x) === x`). Use ambos.

**Q: Como saber se um teste é bom?**
A: Mutation testing. Se você muda `x > 5` pra `x >= 5` e o teste passa, ele é fraco.

---

## 11. Roadmap de adoção

| Semana | Foco | Output |
|---|---|---|
| **γ-Day1** ✅ | Extrair 3 funções críticas + 45 unit tests | clock-skew, rtmp-key, seg-timestamp, segment-format, tenant-scope |
| **W+1** | Mais 10 funções: encrypt/decrypt, buildManifest paging, retention SQL builder, motion-gate logic | ~50 unit tests adicionais |
| **W+2** | Setup RTL + 5 component tests críticos (PlaybackPlayer, MosaicCell, BrandTutorialTabs, ClienteRetentionCard, SudoGuard) | ~25 component tests |
| **W+3** | Setup supertest + 10 integration tests rotas críticas (/auth, /cameras, /playback/token, /exports) | ~30 integration tests |
| **W+4** | Setup Playwright + 5 E2E flows críticos | ~5 specs robustos |
| **W+8** | Mutation testing (Stryker) com subset crítico, gate ≥70% | métricas de qualidade |
| **W+12** | Cobertura 70%+ em backend, gate ativo no CI | suite full ~10min |
