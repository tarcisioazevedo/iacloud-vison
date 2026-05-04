import React from 'react'
import ReactDOM from 'react-dom/client'
import { initSentry, setSentryUser } from './lib/sentry'
import { App } from './App'
import { ThemeProvider } from './lib/theme'
import './styles/globals.css'

initSentry()
setSentryUser()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
