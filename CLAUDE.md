# IA Cloud Vision — Notas para o Claude

## 🚨 ALERTA OBRIGATÓRIO — Antes de qualquer deploy de homologação/produção

**STATUS ATUAL DO PROJETO:** 🟢 Desenvolvimento (não há cliente externo ainda)

**ANTES de promover para homologação ou abrir acesso a integradores piloto, o checklist `docs/PRE-HOMOLOGACAO-CHECKLIST.md` PRECISA estar com todos os P0 marcados como ☑.**

Existem 9 credenciais de produção atualmente em git history (commits `b122d871` e `6aaa945b`, arquivo `docker-stack.yml`):

- PostgreSQL password
- ICV_ENCRYPTION_KEY (master AES-256 que cifra TODAS as senhas RTSP/ONVIF/RTMP do banco)
- R2 access keys (storage de gravações)
- VAPID private key (WebPush)
- Evolution API key (WhatsApp)
- SMTP password

**Quando o usuário (Tarcísio) disser qualquer das frases abaixo, PARE e abra `docs/PRE-HOMOLOGACAO-CHECKLIST.md` antes de prosseguir:**

- "vamos pra homologação"
- "vamos pro piloto"
- "vamos liberar pra integrador"
- "vamos pro cliente"
- "deploy de produção"
- "subir pra prod"
- "abrir o stage"

Se o checklist ainda tiver P0 não marcado, **bloqueie o avanço** e pergunte:

> "Vi que ainda há credenciais P0 não rotacionadas no checklist `docs/PRE-HOMOLOGACAO-CHECKLIST.md`. Confirma que quer prosseguir mesmo assim, ou paramos para rotacionar primeiro?"

---

## Contexto do projeto

- **Produto:** VMS Cloud B2B2B white-label (concorrente de Monuv, BeNuvem, Segware)
- **Stack:** Node.js 20 + Express + Prisma 5 + PostgreSQL 16 + React 19 + Vite + go2rtc + ffmpeg
- **Deploy:** Docker Swarm em VPS Hetzner (Falkenstein, 4 CPU / 8 GB)
- **Proxy/SSL:** Caddy em `/etc/caddy/Caddyfile` (Let's Encrypt automático)
- **Equipe:** 1 dev (Tarcísio) + 1 usuário avançado
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
