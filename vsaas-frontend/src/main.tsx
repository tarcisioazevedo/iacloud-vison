import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ThemeProvider } from './lib/theme'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)

// Sentry boot deferred: rodava síncrono no entry e bloqueava ~160 KB gz
// antes do primeiro paint. Agora carrega após idle (ou fallback setTimeout)
// e é totalmente async. Erros que ocorrem no bootstrap (raros) deixam de
// ser capturados — trade-off aceito por LCP.
const bootSentry = () => {
  void import('./lib/sentry').then(m => {
    try { m.initSentry(); m.setSentryUser() } catch { /* noop */ }
  })
}
if (typeof window !== 'undefined') {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (typeof ric === 'function') ric(bootSentry)
  else setTimeout(bootSentry, 0)
}
