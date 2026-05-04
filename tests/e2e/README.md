# Smoke E2E — IA Cloud Vision

Suite mínima Playwright para garantir que os fluxos críticos do produto não quebrem entre releases.

## Cobertura inicial (5 specs, ~10 testes)

| Arquivo | O que valida |
|---|---|
| `01-health.spec.ts` | `/health`, `/health/ready`, `/openapi.json` (sem login) |
| `02-login.spec.ts` | LoginPage renderiza, credencial inválida mostra erro, credencial válida vai pro dashboard |
| `03-cameras-list.spec.ts` | `/cameras` carrega cards ou empty state claro |
| `04-live-page.spec.ts` | `/live` e `/recordings` montam sem erro JS fatal |
| `05-logout.spec.ts` | Logout limpa token e redireciona para `/login` |

## Setup local

```bash
cd tests/e2e
npm install
npx playwright install --with-deps chromium

cp .env.example .env
# editar .env com credenciais válidas
```

## Rodar

```bash
# headless (CI-like)
npm test

# com browser visível
npm run test:headed

# UI interativa do Playwright (debug)
npm run test:ui

# ver report HTML do último run
npm run report
```

## Rodar apenas um spec

```bash
npx playwright test 01-health
npx playwright test 02-login --headed
```

## CI

O workflow `.github/workflows/vsaas-ci.yml` job `e2e` roda esta suite **apenas via `workflow_dispatch`** por enquanto (precisa secrets `E2E_USER` e `E2E_PASS` configurados no repo).

Para habilitar em PR/push, remover o `if: github.event_name == 'workflow_dispatch'`.

## Como adicionar mais testes

1. Criar `tests/NN-nome.spec.ts`
2. Importar `loginAs` de `tests/_helpers/login` se precisar de sessão
3. Usar `page.getByRole(...)` preferencialmente (mais resiliente que CSS selectors)
4. Adicionar `data-testid="..."` em componentes React quando o seletor por role/text for ambíguo

## Critérios de aceitação

- Roda em <2min no CI
- Não requer câmera real conectada (testes que precisam vão em suite separada `tests/e2e-camera/`)
- Não modifica dados de produção (read-only sempre que possível; quando criar dados, usar prefixo `e2e-` e cleanup)

## Próximos testes (Onda 2/3)

- Criar câmera via wizard (precisa RTSP de teste)
- Configurar regra de evento e disparar manualmente
- Compartilhar link público de gravação e validar TTL
- Acknowledge de alarme com observação obrigatória
- Webhook real (mock-server externo) recebe POST
- Trocar tema dark/light persiste
