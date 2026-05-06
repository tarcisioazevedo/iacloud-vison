# ─────────────────────────────────────────────────────────────────────────────
# IA Cloud Vision — Evolution API custom build
#
# Sobrepõe o `node_modules/baileys` da imagem oficial pelo HEAD do fork
# `EvolutionAPI/Baileys` (mais recente que o pin do upstream).
#
# Uso:
#   docker build -t icv_evolution:baileys-patched -f vsaas-evolution/Dockerfile vsaas-evolution/
#   docker service update --image icv_evolution:baileys-patched --force iacloud_evolution
#
# Status atual (2026-05-06): este patch sozinho NÃO destrava o QR. A causa
# raiz da falha é o IPv6 da VPS Hetzner ser flag-listed pelo WhatsApp como
# datacenter IP — Baileys conecta no WhatsApp Web e o servidor recusa o
# handshake durante "attempting registration" (Error: Connection Failure em
# noise-handler.js:144). Independe da versão do Baileys.
#
# Quando se aplica este Dockerfile:
#   1. Quando upstream Baileys atualizar handshake e contornar a flag de IP
#   2. Quando configurarmos PROXY_HOST/PROXY_PORT (residencial) no Evolution
#   3. Para garantir Baileys atualizado vs lib em fim de vida da imagem oficial
#
# Histórico:
#   - 2026-05-06: Criado durante investigação de QR não emitido
#                 (vide docs/15-RUNBOOK-WHATSAPP.md)
# ─────────────────────────────────────────────────────────────────────────────

FROM atendai/evolution-api:v2.2.3

WORKDIR /evolution

RUN apk add --no-cache git \
    && rm -rf /tmp/bsrc node_modules/baileys \
    && git clone --depth 1 https://github.com/EvolutionAPI/Baileys.git /tmp/bsrc \
    && cd /tmp/bsrc \
    && yarn install --production=false 2>&1 | tail -5 \
    && cp -r /tmp/bsrc /evolution/node_modules/baileys \
    && rm -rf /evolution/node_modules/baileys/.git /tmp/bsrc \
    && node -e 'console.log("baileys patched:", require("/evolution/node_modules/baileys/package.json").version)' \
    && ls /evolution/node_modules/baileys/lib | head -5

# Healthcheck simples (Evolution responde em /)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1
