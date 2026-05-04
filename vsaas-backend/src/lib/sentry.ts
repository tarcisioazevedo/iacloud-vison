import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'

const dsn = process.env.SENTRY_DSN_BACKEND

export function initSentry(): void {
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? undefined,
    serverName: 'iacloud-vsaas-backend',

    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.2),

    integrations: [nodeProfilingIntegration()],

    beforeSend(event) {
      const status = event.contexts?.response?.status_code as number | undefined
      if (status && status >= 400 && status < 500) return null
      return event
    },

    ignoreErrors: [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'QUOTA_EXCEEDED',
    ],
  })
}

export { Sentry }
