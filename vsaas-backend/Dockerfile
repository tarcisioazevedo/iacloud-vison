FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ── Deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package*.json ./
RUN npm ci

# ── Build ─────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN npx prisma generate
RUN npm run build

# ── Dev (hot-reload) ──────────────────────────────────────────────────────
FROM deps AS dev
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "dev"]

# ── Production ────────────────────────────────────────────────────────────
FROM base AS production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./
CMD ["node", "dist/index.js"]
