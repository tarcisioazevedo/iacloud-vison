# Invariantes de Domínio — IA Cloud Vision

> **Invariantes** são regras que o sistema **garante a todo momento** — em qualquer
> caminho de código, em qualquer estado válido do banco. Se uma invariante quebra,
> é bug crítico, não comportamento esperado.

Este documento lista as invariantes do produto, em qual camada cada uma é
garantida, e onde estão os testes que provam que elas se mantêm.

---

## I-1. Toda câmera vive sob um site

**Regra:** Toda `Camera` (Box Cam ou Direct Cam) tem `siteId` não-nulo. Não existe
câmera órfã no sistema.

**Garantido em 3 camadas:**

| Camada | Mecanismo | Local |
|---|---|---|
| Banco | `Camera.siteId String` (NOT NULL) — FK para `Site.id` | `vsaas-backend/prisma/schema.prisma:880` |
| API | `resolveCreateCameraSiteId()` força resolução antes de inserir | `vsaas-backend/src/lib/tenant-scope.ts:199` |
| UI | Wizard de câmera bloqueia "Próximo" se `!siteId`; banner âmbar quando o tenant tem 0 sites | `vsaas-frontend/src/components/cameras/AddCameraWizard.tsx` (gate `siteGateBlocked`) |

**Implicações:**
- Cliente final sem nenhum site **não pode** ter câmera. Para cadastrar a 1ª
  câmera, primeiro cria o site.
- A invariante vale igual para **Box Cam** e **Direct Cam**. O modo de deploy
  só altera se há ou não box intermediária — não dispensa o site.

**Comportamento na ausência de siteId no payload:**

| Sites no tenant | Comportamento |
|---|---|
| 0 | `400 ValidationError` *"nenhum site cadastrado, cadastre um site primeiro"* |
| 1 | Autopreenche silenciosamente (UX 1º cadastro) |
| 2+ | `400 ValidationError` *"informe o siteId explicitamente"* |

**Testado em:** `vsaas-backend/src/lib/tenant-scope.spec.ts` (15 testes).

---

## I-2. Câmera com box: ambas no mesmo site

**Regra:** Se `Camera.edgeNodeId` não é nulo, então `Camera.siteId === EdgeNode.siteId`.
Câmera nunca aponta para uma box que está em outro site.

**Garantido por:** FK composto no Prisma:

```prisma
edgeNode EdgeNode? @relation(fields: [siteId, edgeNodeId], references: [siteId, id])
```

`EdgeNode` tem `@@unique([siteId, id])`, então o FK composto funciona como
referencial. Postgres rejeita inserção de câmera apontando para
`(siteId=A, edgeNodeId=box-no-site-B)`.

**Local:** `vsaas-backend/prisma/schema.prisma:1116` (Camera) + `prisma/schema.prisma:776` (EdgeNode unique composto).

**Testabilidade:** depende de banco real (Postgres rejeita a inserção). Não
coberto em testes unitários — fica para suíte de integração com testcontainers
quando montarmos.

---

## I-3. Direct Cam = câmera sem box

**Regra:** `Camera.edgeNodeId IS NULL ⇔ Camera.deploymentMode = 'CLOUD_DIRECT'`.
São Direct Cams: câmeras que conectam direto à cloud, sem hardware
intermediário no site.

**Garantido em:**

| Camada | Mecanismo |
|---|---|
| API (criação) | `routes/cameras.ts`: default `deploymentMode = edgeNodeId ? 'EDGE_BOX' : 'CLOUD_DIRECT'` |
| Wizard | Step "modo" pede explicitamente Edge Box vs Direct Cam; pipeline e protocolo dependem dessa escolha |
| UI (visualização) | TreeView separa em duas seções: câmeras-sob-box e Direct Cams do site |

**Atenção:** o sistema *atual* não tem trigger explícito que rejeite a combinação
`(edgeNodeId='box-1', deploymentMode='CLOUD_DIRECT')` — a coerência é mantida
pela API. Não criar câmera bypassando a API (raw SQL) para preservar a invariante.

---

## I-4. Hierarquia de tenancy

**Regra:** `Integrador → ClienteFinal → Site → Camera`. Toda câmera tem
exatamente um caminho até o integrador-tenant que a "possui".

**Garantido por:**

```
Integrador.id ←─ ClienteFinal.integradorId  (NOT NULL)
ClienteFinal.id ←─ Site.clienteFinalId       (NOT NULL)
Site.id ←─ Camera.siteId                     (NOT NULL — ver I-1)
```

Todas as três FKs são obrigatórias no schema. Câmera órfã em qualquer nível
da cadeia é impossível.

**Implicação prática:** consultas multi-tenant (`tenant-scope.ts`) sempre
resolvem para a cadeia completa. O JWT carrega `integradorId` e/ou
`clienteFinalId`; queries são automaticamente filtradas.

---

## I-5. Anti-vazamento cross-tenant

**Regra:** Quando um usuário tenta acessar/criar com um id que pertence a outro
tenant, a resposta é **404 Not Found**, nunca 403/Forbidden. Isso impede
descobrir a existência de recursos de outros tenants por brute-force.

**Onde:**
- `assertSiteBelongsToUser()` retorna 404 se site é de outro tenant
- `requireCameraForUser()` idem
- `tenant-scope.ts` em geral

**Testado em:** `tenant-scope.spec.ts` — caso "I-4: 404 não vaza existência
cross-tenant".

---

## Como adicionar uma nova invariante

1. Documente aqui na seção apropriada (regra + camadas + testes)
2. Garanta a regra em **pelo menos 2 camadas** (idealmente DB + API). UI sozinha
   não conta — código que bypassa a UI ainda precisa do guard.
3. Escreva o teste que falha quando a invariante quebra. Sem teste, a invariante
   é só uma intenção — não está garantida.
4. Cite o caminho do arquivo e a linha exata onde a regra é forçada.

## Anti-padrões — o que **não** é invariante

- "Toda câmera deveria ter um nome amigável" → é validação de input, não invariante (o sistema funciona se faltar)
- "Edge box deveria ter heartbeat recente" → é health check, não invariante (box offline ainda existe no banco)
- "Cliente final ativo deveria ter pelo menos 1 site" → é métrica de adoção, não invariante (cliente recém-criado tem 0 sites)

Invariantes são as regras cuja violação **corrompe o estado do sistema**.
Tudo o mais é validação ou observabilidade.
