FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Produção: serve estático com nginx ────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
RUN find /usr/share/nginx/html -name '*.map' -type f -delete

# SPA fallback + cache headers
RUN echo 'server { \
    listen 8080; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    location ~* \.html$ { \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        add_header Pragma "no-cache"; \
        add_header Expires "0"; \
    } \
    location = /manifest.webmanifest { \
        default_type application/manifest+json; \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        try_files /manifest.webmanifest =404; \
    } \
    location = /sw.js { \
        default_type application/javascript; \
        add_header Cache-Control "no-cache, no-store, must-revalidate"; \
        try_files /sw.js =404; \
    } \
    location ~* \.(js|css)$ { \
        add_header Cache-Control "public, max-age=31536000, immutable"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
