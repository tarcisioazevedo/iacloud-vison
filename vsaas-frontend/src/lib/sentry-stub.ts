// Stub local do @sentry/react para preview de dev sem instalar a dep.
// Vite resolve '@sentry/react' para este arquivo via alias em vite.config.ts.
// Remover/desativar quando @sentry/react estiver instalado.

const noop = () => {}

export function init(_opts?: unknown): void {}
export function setUser(_user: unknown): void {}
export function setTag(_k: string, _v: string): void {}
export function captureException(_e: unknown, _ctx?: unknown): void {}
export function browserTracingIntegration(): unknown { return {} }
export function replayIntegration(_opts?: unknown): unknown { return {} }

export type ErrorEvent = {
  exception?: { values?: { type?: string }[] }
  contexts?: { response?: { status_code?: number } }
}

export default {
  init,
  setUser,
  setTag,
  captureException,
  browserTracingIntegration,
  replayIntegration,
  withScope: (cb: (scope: { setTag: typeof setTag }) => void) => cb({ setTag }),
  addBreadcrumb: noop,
}
