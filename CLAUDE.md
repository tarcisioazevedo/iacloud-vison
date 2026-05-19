# IA Cloud Vision — Notas para o Claude

## 🚨 ALERTA OBRIGATÓRIO — Antes de homologação ou produção

**STATUS ATUAL DO PROJETO:** 🟡 Homologação (cliente piloto controlado)

O checklist tem **dois níveis** em `docs/PRE-HOMOLOGACAO-CHECKLIST.md`:

### Gatilhos de HOMOLOGAÇÃO (cliente piloto único, ambiente controlado)

**Quando o usuário disser qualquer das frases abaixo, PARE e verifique os P0 da seção "PRÉ-HOMOLOGAÇÃO":**

- "vamos pra homologação"
- "vamos pro piloto"
- "vamos liberar pra integrador"
- "vamos pro cliente"
- "abrir o stage"
- "iniciar homologação"

Se ainda houver P0 PRÉ-HOMOLOGAÇÃO com `☐`, **bloqueie e pergunte:**
> "Vi que ainda há itens P0 de homologação abertos no checklist. Corrijo agora ou quer prosseguir assim mesmo?"

**P0 de homologação são de código** (manifest HLS, partições de DB, delete local após upload) — eu consigo corrigir sozinho.

### Gatilhos de PRODUÇÃO (múltiplos integradores / dados comerciais reais)

**Quando o usuário disser qualquer das frases abaixo, PARE e verifique os P0 da seção "PRÉ-PRODUÇÃO":**

- "deploy de produção"
- "subir pra prod"
- "produção real"
- "abrir pra todos"
- "lançamento"

Se ainda houver P0 PRÉ-PRODUÇÃO com `☐`, **bloqueie e pergunte:**
> "Vi que ainda há credenciais P0 não rotacionadas para produção no checklist `docs/PRE-HOMOLOGACAO-CHECKLIST.md`. As credenciais originais continuam no git history (commits `b122d871` e `6aaa945b`). Confirma que quer prosseguir mesmo assim?"

**P0 de produção são de credenciais** — exigem ação manual do Tarcísio (rotação no painel Cloudflare, Evolution, SMTP, Postgres). Plano detalhado em `docs/PLAN-ROTATE-CREDENTIALS.md`.

---

## Contexto do projeto

- **Produto:** VMS Cloud B2B2B white-label (concorrente de Monuv, BeNuvem, Segware)
- **Stack:** Node.js 20 + Express + Prisma 5 + PostgreSQL 16 + React 19 + Vite + go2rtc + ffmpeg
- **Deploy:** Docker Swarm em VPS Hetzner (Falkenstein, 4 CPU / 8 GB)
- **Proxy/SSL:** Caddy em `/etc/caddy/Caddyfile` (Let's Encrypt automático)
- **Equipe:** 1 dev (Tarcísio) — solo. Sem QA, sem usuário-piloto ainda.
- **Prazo MVP campo:** 120-150 dias
- **Branch atual:** `dev`

## Documentos de referência

- `docs/00-INVESTIGACAO-PRE-MVP.md` — Investigação técnica detalhada (proxy, edge, capacidade, credenciais)
- `docs/01-DIAGNOSTICO.md` — Diagnóstico completo (matriz de features, débitos técnicos, score MVP)
- `docs/PRE-HOMOLOGACAO-CHECKLIST.md` — Checklist obrigatório antes de homologação
- `docs/DIAGNOSTICO.md` — Versão compacta do diagnóstico

## Defesas automatizadas instaladas

- **Git hook `pre-push`** (`scripts/git-hooks/pre-push`): bloqueia push para `main`/`master`
  enquanto houver itens P0 com `☐` em `docs/PRE-HOMOLOGACAO-CHECKLIST.md`. Push para `dev`
  e feature branches passa livre.
  - Ativação (1x por clone): `bash scripts/git-hooks/install.sh`
  - Override consciente: `ICV_FORCE_PUSH=1 git push` (registra user+timestamp)
  - Bypass total: `git push --no-verify` (não recomendado)

## Convenções

- Linguagem da conversa: **português** (Tarcísio é brasileiro)
- Estilo: direto, técnico, sem rodeios. Apontar gambiarras quando vir.
- Não inventar — sempre ler o arquivo antes de afirmar
- Antes de propor solução, perguntar contexto se ambíguo
