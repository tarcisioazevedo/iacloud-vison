/**
 * IA Cloud Vision — Service Worker (Sprint Q.1 + Q.2)
 *
 * Responsabilidades:
 *   1. Receber WebPush e exibir Notification.
 *   2. Encaminhar clique → focar/abrir aba do dashboard.
 *   3. Cache app-shell mínimo (offline-first para index.html + assets críticos).
 *   4. Background Sync hook (estendível pra retry de API).
 *
 * Não tente importar módulos ESM aqui — é Worker tradicional, sem bundler.
 */

const CACHE_VERSION = 'icv-v1'
const APP_SHELL = ['/', '/index.html', '/icons/icon-192.png', '/icons/icon-512.png']

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
 *   - /api/*  → network-only (não cache de dados sensíveis multi-tenant).
 *   - assets  → stale-while-revalidate.
 *   - navegação (mode=navigate) → network falling back to cached index.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (url.pathname.startsWith('/api/')) {
    return // deixa o browser tratar
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    )
    return
  }

  if (event.request.method !== 'GET') return

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
        .catch(() => cached)
      return cached || fetchPromise
    })
  )
})

/**
 * WebPush handler.
 * Backend envia JSON: { title, body, icon?, badge?, tag?, url?, data? }
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'IA Cloud Vision', body: 'Você tem uma nova notificação.' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    try { payload = { title: 'IA Cloud Vision', body: event.data && event.data.text() || '' } } catch {}
  }

  const options = {
    body:  payload.body || '',
    icon:  payload.icon  || '/icons/icon-192.png',
    badge: payload.badge || '/icons/badge-72.png',
    tag:   payload.tag   || 'icv-default',
    data:  Object.assign({ url: payload.url || '/' }, payload.data || {}),
    vibrate: [120, 60, 120],
    requireInteraction: !!(payload.data && payload.data.requireInteraction),
    timestamp: Date.now(),
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'IA Cloud Vision', options))
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
      wins.forEach((w) => w.postMessage({ type: 'icv-push-subscription-change' }))
    })
  )
})
