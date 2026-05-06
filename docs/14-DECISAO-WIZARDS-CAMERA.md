# Decisão: dois `AddCameraWizard` — `Quick` vs `Advanced`

**Criado:** 2026-05-06
**Origem:** auditoria dos mockups (`docs/preview/05-wizard-adicionar-camera.html`) vs. implementação real
**Status:** **Decisão proposta — aguardando confirmação** (responsável: Tarcísio)

---

## 1. Situação real no código

Existem **dois componentes distintos** chamados `AddCameraWizard` no projeto:

| Caminho | Linhas | Steps | Estilo | Onde é usado | Casa com mockup 05? |
|---|---|---|---|---|---|
| `vsaas-frontend/src/components/hierarchy/AddCameraWizard.tsx` | 593 | **4** (Modo / Configurar / Validar / Concluído) | Moderno, minimalista, foco no caminho feliz | `TreeView` (cockpits Fabricante / Integrador / Cliente Final) | ✅ **Sim — é o do mockup** |
| `vsaas-frontend/src/components/cameras/AddCameraWizard.tsx` | 1.026 | **7** (Info / Conexão / Detector / Motion / Avançado / Retenção / Revisar) | "Estilo Frigate completo" — cobre todos os campos avançados | `CamerasPage.tsx` (página dedicada de câmeras) | ❌ — fluxo diferente |

Ambos invocam `POST /cameras` no final. **Não há colisão de nome no JS** porque ficam em pastas distintas — quem importa precisa escolher caminho explícito.

## 2. Por que foram criados em paralelo

Ordem cronológica reconstruída via `git log`:

1. `components/cameras/AddCameraWizard.tsx` foi escrito primeiro (Sprint inicial de Câmeras), quando o foco era paridade com Frigate. Ele expõe **todos** os campos do schema (motion zones, hwAccel, retenção fina por skill de IA, etc.).
2. Quando o cockpit hierárquico (`TreeView`) foi adicionado (Onda 1.G do `13-PLAN-COCKPIT-PREMIUM.md`), o fluxo "Frigate-completo" era pesado demais para o caso comum (técnico campo cadastrando câmera no site). Foi escrito um wizard **Quick Add** focado no mockup 05, com defaults sensatos.
3. Os dois ficaram convivendo. Não há débito acumulado de inconsistência (ambos chamam o mesmo endpoint REST), mas há **carga cognitiva** pra novos desenvolvedores.

## 3. Decisão proposta: **manter os dois, separar nomes**

### Renomear

| Arquivo atual | Renomeado para | Por quê |
|---|---|---|
| `components/hierarchy/AddCameraWizard.tsx` | `components/hierarchy/QuickAddCameraWizard.tsx` | É o caminho rápido (4 steps) — usado em 90% dos casos |
| `components/cameras/AddCameraWizard.tsx` | `components/cameras/AdvancedAddCameraWizard.tsx` | É o caminho avançado (7 steps) — power user / Frigate-tuning |

### UX consolidado em CamerasPage

No `CamerasPage`, oferecer ambos via dropdown único:

```
+ Nova câmera ▾
  ├─ ⚡ Adição rápida   (default — abre QuickAddCameraWizard)
  └─ 🔧 Adição avançada (link "configurações de IA, motion, retenção")
```

No TreeView (cockpits), continuar usando só o `QuickAddCameraWizard`. O fluxo avançado fica reservado para a página dedicada (CamerasPage) onde o operador já está no contexto "configurando câmeras a sério".

### Consolidar configurações avançadas no detalhe

Hoje o `AdvancedAddCameraWizard` configura tudo no momento da criação. **Mover** os steps de Detector/Motion/Avançado/Retenção para a tela de **detalhe da câmera** (`CameraDetailPage`), permitindo:

- Criar com defaults sensatos (rápido)
- Refinar em tab separada quando precisar (não-bloqueante)

Resultado: o "Advanced" reduz de 7 para 3 steps reais (Info / Conexão / Revisar) — semelhante ao Quick mas com mais campos manuais (RTSP sub-stream, hwAccel hint, etc.). O resto vira **edição pós-criação**.

## 4. Plano de execução (proposta)

| # | Item | Esforço | Impacto |
|---|---|---|---|
| 1 | Renomear arquivos + ajustar imports (`grep -r AddCameraWizard`) | 0.5h | Zero — só rename |
| 2 | Adicionar dropdown "Rápido / Avançado" no `CamerasPage` | 0.5h | UX clara |
| 3 | Migrar Detector/Motion/Avançado/Retenção pra `CameraDetailPage` (tabs) | 4-6h | Reduz fricção do "Advanced" |
| 4 | Reduzir `AdvancedAddCameraWizard` pra 3 steps (Info/Conexão/Revisar) | 2h | Consistência com Quick |
| 5 | Atualizar `13-PLAN-COCKPIT-PREMIUM.md` mencionando dois fluxos | 0.2h | Documentação |
| **Total** | | **~7-9h** | dev pleno: 1 dia |

## 5. Alternativas descartadas

### (A) Unificar em um wizard só com modo "básico/avançado"

**Descartado.** Tentamos esse padrão antes — vira um wizard gigante que serve mal aos dois casos. A regra "menor caminho do caso comum > flexibilidade" venceu.

### (B) Remover o avançado e mover tudo pra `CameraDetailPage`

**Descartado.** Há campos que precisam ser definidos **antes** da câmera entrar em produção (ex: RTSP sub-stream URL, ingestMode RTMP_PUSH com chave gerada). Forçar 2-passos sequenciais (cria stub → edita) frustra o operador experiente.

### (C) Manter status quo (dois com mesmo nome)

**Descartado.** Confunde IDE auto-import (volta-e-meia importa o errado) e revisores de PR.

## 6. Riscos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Refactor quebra teste smoke E2E | Baixa | Smoke E2E ainda inexistente (Onda 1 do `08`); validação manual cobre |
| Operadores Frigate-pesados reclamam de menos campos no Advanced | Baixa | Campos ficam acessíveis em CameraDetailPage; é melhoria, não remoção |
| Imports quebram durante rename | Média | grep+sed em 1 comando; build:tsc verifica |

## 7. Próxima ação

**Aguarda decisão do Tarcísio.** Opções:

- **(I)** Aprovar a proposta acima → executar em backlog (1 dia de dev pleno)
- **(II)** Manter status quo até primeiro feedback de operador real (lazy approach)
- **(III)** Re-propor com diferenças

Sem decisão explícita, o estado atual segue funcionando — esse débito não bloqueia nenhuma venda nem nenhuma rota crítica. Só carrega carga cognitiva pra dev novo.

---

**Referências:**
- Mockup: `vsaas-frontend/public/preview/05-wizard-adicionar-camera.html`
- Quick: `vsaas-frontend/src/components/hierarchy/AddCameraWizard.tsx`
- Advanced: `vsaas-frontend/src/components/cameras/AddCameraWizard.tsx`
- Auditoria de mockups vs código: conversa Cloud 2026-05-06
