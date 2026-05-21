/**
 * VSaaS — Service Worker (Sprint Q.1 + Q.2)
 *
 * Responsabilidades:
 *   1. Receber WebPush e exibir Notification.
 *   2. Encaminhar clique → focar/abrir aba do dashboard.
 *   3. Cache app-shell mínimo (offline-first para index.html + assets críticos).
 *   4. Background Sync hook (estendível pra retry de API).
 *
 * Não tente importar módulos ESM aqui — é Worker tradicional, sem bundler.
 */

// CACHE_VERSION precisa subir a cada deploy pra forçar reinstall do SW e
// invalidação de caches de versões anteriores. Convenção: 'icv-vN-YYYYMMDD'.
// Subir o número quando houver mudanças no app shell ou na estratégia de fetch;
// subir só a data em deploys de bug-fix.
// Subir versão sempre que mudar a estratégia abaixo. Bump 2026-05-14:
// excluir endpoints dinâmicos (playback/detections/live) do cache — antes
// cacheava .ts presigned e quebrava o playback HLS servindo bytes antigos.
const CACHE_VERSION = 'vsaas-v16-20260521-sw-fallback'

// Resposta de fallback usada quando rede falha E cache não tem o recurso.
// Evita o erro "Failed to convert value to 'Response'" que acontece quando
// caches.match retorna undefined e event.respondWith recebe Promise<undefined>.
function offlineFallback() {
  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
}
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/brand/favicon.png', '/brand/vsaas-wordmark-transparent.png', '/brand/vsaas-logomark.png', '/brand/vsaas-symbol-transparent.png', '/icons/icon-192.png']

// Endpoints NÃO cacháveis (auth, ranges presigned, conteúdo per-request).
// SW só serve cache pra app shell + assets hashados do Vite.
const NO_CACHE_PATHS = [
  /^\/playback\//,
  /^\/detections\//,
  /^\/live\//,
  /^\/cameras\//,
  /^\/recordings\//,
  /^\/iacv-box\//,
  /^\/notifications\//,
  /^\/admin\//,
  /\.ts(\?|$)/,           // segmentos HLS
  /\.m3u8(\?|$)/,         // playlists HLS
]

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(APP_SHELL).catch(() => {/* shell parcial é ok */})
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

/**
 * Fetch strategy:
 *   - /api/*           → network-only (não cache de dados sensíveis multi-tenant).
 *   - /sw.js, /index.html, /manifest.* → network-first (deploys aparecem rápido).
 *   - assets hashados (chunks com fingerprint do vite) → stale-while-revalidate.
 *   - navegação (mode=navigate) → network falling back to cached index.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (url.pathname.startsWith('/api/')) {
    return // deixa o browser tratar
  }

  // Endpoints dinâmicos/autenticados: passthrough sem cachear.
  // Sem isso, segmentos HLS `.ts` ficavam cacheados de uma sessão anterior
  // e o player decodificava bytes obsoletos (player travado em 0:00).
  if (NO_CACHE_PATHS.some((re) => re.test(url.pathname))) {
    return
  }

  // Origens cross-origin (R2/S3 etc) — deixa o browser tratar diretamente.
  // SW interceptando preflight CORS causa erros falsos no console.
  if (url.origin !== self.location.origin) {
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('/index.html')
        return cached || offlineFallback()
      }),
    )
    return
  }

  if (event.request.method !== 'GET') return

  // Network-first para arquivos críticos não-hashados — garante que um deploy
  // novo seja visto em segundos, não horas. Se a rede falhar, cai pro cache.
  const isCriticalShell = /^\/(sw\.js|index\.html|manifest\.webmanifest)$/.test(url.pathname)
    || url.pathname === '/'
  if (isCriticalShell) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone()
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone))
          }
          return res
        })
        .catch(async () => (await caches.match(event.request)) || offlineFallback()),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone()
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone))
          }
          return res
        })
        .catch(() => cached || offlineFallback())
      return cached || fetchPromise
    }),
  )
})

/**
 * WebPush handler.
 * Backend envia JSON: { title, body, icon?, badge?, tag?, url?, data? }
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'VSaaS', body: 'Você tem uma nova notificação.' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    try { payload = { title: 'VSaaS', body: event.data && event.data.text() || '' } } catch {}
  }

  const options = {
    body:  payload.body || '',
    icon:  payload.icon  || '/brand/favicon.png',
    badge: payload.badge || '/icons/badge-72.png',
    tag:   payload.tag   || 'vsaas-default',
    data:  Object.assign({ url: payload.url || '/' }, payload.data || {}),
    vibrate: [120, 60, 120],
    requireInteraction: !!(payload.data && payload.data.requireInteraction),
    timestamp: Date.now(),
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'VSaaS', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        try {
          const u = new URL(w.url)
          if (u.pathname === target || u.href.endsWith(target)) {
            return w.focus()
          }
        } catch {}
      }
      return self.clients.openWindow(target)
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  // Reapply subscription on browser-initiated rotation. Postpone real impl
  // (need VAPID key + backend re-subscribe). For now, log via clients.
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((wins) => {
      wins.forEach((w) => w.postMessage({ type: 'vsaas-push-subscription-change' }))
    })
  )
})
