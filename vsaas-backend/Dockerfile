FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl ffmpeg docker-cli python3 py3-pip bash curl \
      ttf-dejavu fontconfig && \
    pip3 install --break-system-packages yt-dlp && \
    fc-cache -fv 2>/dev/null || true

# ── Deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ── Dev (hot-reload) ──────────────────────────────────────────────────────
FROM deps AS dev
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "dev"]

# ── Production — usa tsx diretamente (esbuild, sem step tsc) ─────────────
# tsx executa TypeScript nativo via esbuild: startup rápido, zero build time,
# mesma DX do dev. Elimina erros de tipo que não afetam runtime.
FROM deps AS production
COPY . .
RUN npx prisma generate
CMD ["npx", "tsx", "src/index.ts"]
