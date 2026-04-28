/**
 * Sprint Q.1 — usePushSubscription
 *
 * Encapsula todo o ritual chato do WebPush:
 *   1. Pede permissão (`Notification.requestPermission`)
 *   2. Busca VAPID public key do backend
 *   3. Registra/recupera ServiceWorker
 *   4. Cria PushSubscription via PushManager
 *   5. POST /push/subscribe (idempotente — backend usa upsert por p256dh)
 *   6. Persiste estado em React + localStorage (lembra da inscrição)
 *
 * Suporta degradação:
 *   - browser sem Notification API → `supported=false`, retorna no-op
 *   - browser sem PushManager → idem
 *   - VAPID simulated (backend sem web-push instalado) → `simulated=true`
 *     mas inscrição local funciona
 *   - permission "denied" → `denied=true` para UI mostrar "vá nas configs do browser"
 */
import { useCallback, useEffect, useState } from 'react'
import {
  getVapidPublicKey,
  subscribePush,
  unsubscribePush,
  sendTestPush,
  formatApiError,
} from '../api/client'

export type PushPermission = 'default' | 'granted' | 'denied'

export interface UsePushSubscriptionResult {
  supported: boolean
  permission: PushPermission
  subscribed: boolean
  loading: boolean
  error: string | null
  simulated: boolean
  /** Pede permissão (se necessário) e cria a subscription. Retorna `true` em sucesso. */
  enable: () => Promise<boolean>
  /** Cancela no servidor + unsubscribe local. */
  disable: () => Promise<void>
  /** Dispara um push de teste para o próprio actor logado. */
  test: (payload?: { title?: string; body?: string }) => Promise<void>
}

const LS_KEY = 'icv_push_p256dh'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(raw)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function isPushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const supported = isPushSupported()
  const [permission, setPermission] = useState<PushPermission>(
    supported ? (Notification.permission as PushPermission) : 'denied',
  )
  const [subscribed, setSubscribed] = useState<boolean>(
    supported && !!localStorage.getItem(LS_KEY),
  )
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [simulated, setSimulated] = useState(false)

  // Ao montar, pergunta ao SW se já tem subscription ativa.
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (cancelled) return
        if (sub) {
          setSubscribed(true)
          // re-arma localStorage caso usuário tenha limpado
          const p256 = sub.toJSON().keys?.p256dh
          if (p256) localStorage.setItem(LS_KEY, p256)
        }
      } catch {/* idem — mantém estado */}
    })()
    return () => { cancelled = true }
  }, [supported])

  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setError('Seu navegador não suporta notificações push.')
      return false
    }
    setLoading(true)
    setError(null)
    try {
      // 1. Permissão
      let perm = Notification.permission as PushPermission
      if (perm === 'default') {
        perm = (await Notification.requestPermission()) as PushPermission
      }
      setPermission(perm)
      if (perm !== 'granted') {
        setError(perm === 'denied'
          ? 'Permissão negada. Habilite notificações nas configurações do navegador.'
          : 'Permissão não concedida.')
        return false
      }

      // 2. VAPID key
      const { publicKey, simulated: sim } = await getVapidPublicKey()
      setSimulated(sim)

      // 3. SW (já registrado em index.html, mas garantimos)
      const reg = await navigator.serviceWorker.ready

      // 4. Subscription — reutiliza se já existe com mesma key
      const existing = await reg.pushManager.getSubscription()
      const subscription = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // TS 5.x diferencia Uint8Array<ArrayBufferLike> vs ArrayBuffer — copia
        // pra um Uint8Array<ArrayBuffer> "puro" pra satisfazer BufferSource.
        applicationServerKey: new Uint8Array(urlBase64ToUint8Array(publicKey)).buffer as ArrayBuffer,
      })

      const json = subscription.toJSON()
      const p256 = json.keys?.p256dh
      const auth = json.keys?.auth
      if (!p256 || !auth || !json.endpoint) {
        throw new Error('Subscription incompleta — browser não retornou keys')
      }

      // 5. Persist no backend
      await subscribePush({
        endpoint: json.endpoint,
        keys: { p256dh: p256, auth },
        userAgent: navigator.userAgent,
      })

      localStorage.setItem(LS_KEY, p256)
      setSubscribed(true)
      return true
    } catch (e) {
      setError(formatApiError(e))
      return false
    } finally {
      setLoading(false)
    }
  }, [supported])

  const disable = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      const p256 = sub?.toJSON().keys?.p256dh ?? localStorage.getItem(LS_KEY)
      if (sub) await sub.unsubscribe().catch(() => {/* tolera */})
      if (p256) await unsubscribePush(p256).catch(() => {/* tolera */})
      localStorage.removeItem(LS_KEY)
      setSubscribed(false)
    } catch (e) {
      setError(formatApiError(e))
    } finally {
      setLoading(false)
    }
  }, [supported])

  const test = useCallback(async (payload?: { title?: string; body?: string }) => {
    setError(null)
    try {
      await sendTestPush(payload)
    } catch (e) {
      setError(formatApiError(e))
      throw e
    }
  }, [])

  return { supported, permission, subscribed, loading, error, simulated, enable, disable, test }
}
