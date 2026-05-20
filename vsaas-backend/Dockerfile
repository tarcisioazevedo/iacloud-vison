FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl ffmpeg docker-cli python3 py3-pip bash curl && \
    pip3 install --break-system-packages yt-dlp

# ── Deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ── Dev (hot-reload) ──────────────────────────────────────────────────────
FROM deps AS dev
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "dev"]

# ── Production — compila TypeScript → node dist/ ─────────────────────────
# tsc emite JS estático: zero overhead de esbuild em runtime, processo
# Node puro. tsx em produção custa ~250%+ CPU em idle (file watcher do esbuild).
FROM deps AS production
COPY . .
RUN npx prisma generate && npx tsc
CMD ["node", "dist/index.js"]
