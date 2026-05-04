import * as Sentry from '@sentry/react'

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE ?? undefined,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],

    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    beforeSend(event) {
      if (event.exception?.values?.some(v => v.type === 'AxiosError')) {
        const status = event.contexts?.response?.status_code as number | undefined
        if (status && status >= 400 && status < 500) return null
      }
      return event
    },
  })
}

export function setSentryUser(): void {
  const token = localStorage.getItem('icv_token')
  if (!token) {
    Sentry.setUser(null)
    return
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    Sentry.setUser({
      id: payload.sub,
      ...(payload.role && { role: payload.role }),
      ...(payload.integradorId && { integradorId: payload.integradorId }),
      ...(payload.clienteFinalId && { clienteFinalId: payload.clienteFinalId }),
    })

    if (payload.integradorId) {
      Sentry.setTag('tenant.integradorId', payload.integradorId)
    }
  } catch {
    // JWT inválido — ignora
  }
}

export { Sentry }
