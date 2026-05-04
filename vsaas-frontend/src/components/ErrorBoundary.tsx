import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('[ErrorBoundary]', error, info)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div className="p-6">
        <div className="max-w-2xl mx-auto bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-rose-700 dark:text-rose-300">Erro ao renderizar página</h2>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{error.message}</p>
              <pre className="text-xs text-slate-500 dark:text-slate-400 mt-3 overflow-x-auto bg-black/5 dark:bg-black/30 p-3 rounded">
                {error.stack?.slice(0, 800)}
              </pre>
              <button
                onClick={this.reset}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
