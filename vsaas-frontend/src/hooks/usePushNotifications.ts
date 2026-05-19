/**
 * usePushNotifications — gerencia o ciclo de vida das Web Push Notifications.
 *
 * Fluxo:
 *   1. subscribe() → pede permissão → registra no pushManager → POST backend
 *   2. unsubscribe() → revoga no pushManager → DELETE backend
 *   3. Estado: 'idle' | 'granted' | 'denied' | 'unsupported' | 'loading'
 */
import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

export type PushState = 'idle' | 'loading' | 'granted' | 'denied' | 'unsupported'

async function getVapidKey(): Promise<string | null> {
  try {
    const { data } = await api.get('/notifications/webpush/vapid-key')
    return data.vapidPublicKey ?? null
  } catch {
    return null
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding  = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData  = window.atob(base64)
  const output   = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i)
  return output
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('idle')

  // Detecta suporte e estado inicial
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    // Verifica se já tem subscription ativa
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription()
    ).then(sub => {
      setState(sub ? 'granted' : 'idle')
    }).catch(() => setState('idle'))
  }, [])

  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return false
    }

    setState('loading')
    try {
      const vapidKey = await getVapidKey()
      if (!vapidKey) throw new Error('VAPID key não disponível')

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('denied')
        return false
      }

      const reg = await navigator.serviceWorker.ready
      let sub   = await reg.pushManager.getSubscription()

      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        })
      }

      const subJson = sub.toJSON() as {
        endpoint: string
        keys?: { p256dh?: string; auth?: string }
      }

      await api.post('/notifications/webpush/subscribe', {
        endpoint:  subJson.endpoint,
        p256dh:    subJson.keys?.p256dh   ?? '',
        authKey:   subJson.keys?.auth     ?? '',
        userAgent: navigator.userAgent.slice(0, 200),
      })

      setState('granted')
      return true
    } catch (err) {
      console.warn('push subscribe error', err)
      setState('idle')
      return false
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setState('loading')
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()

      if (sub) {
        await api.delete('/notifications/webpush/subscribe', {
          data: { endpoint: sub.endpoint },
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setState('idle')
      return true
    } catch {
      setState('granted')
      return false
    }
  }, [])

  return { state, subscribe, unsubscribe }
}
