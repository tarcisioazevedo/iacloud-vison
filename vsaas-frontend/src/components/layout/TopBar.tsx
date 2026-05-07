/**
 * TopBar — header sticky com busca rápida, notificações e menu do usuário.
 *
 * Layout (esquerda → direita):
 *   1. Search "Buscar integrador, cliente, site ou câmera…" (abre Cmd+K)
 *   2. QuickAlertsButton (super-admin)            — alertas críticos do sistema
 *   3. PendingTasksButton (super-admin)           — leads + aprovações
 *   4. NotificationsBell (todas)                  — histórico local de toasts
 *   5. UserMenu (todas)                           — perfil, senha, tema, logout
 *
 * RBAC: cada componente acima decide internamente se aparece para a role atual.
 * Indicador "AO VIVO" foi removido (não agregava info — pulse do sino já indica).
 */
import { Search, Menu } from 'lucide-react'
import { NotificationsBell } from '../notifications/NotificationsBell'
import { QuickAlertsButton } from './QuickAlertsButton'
import { PendingTasksButton } from './PendingTasksButton'
import { UserMenu } from './UserMenu'
import { ImpersonateQuickAccess } from '../auth/ImpersonateQuickAccess'

interface TopBarProps {
  title?: string
  vertical?: string
  /** Mostra botão hambúrguer (apenas mobile — controlado pelo Layout). */
  showHamburger?: boolean
  /** Callback do hambúrguer — abre drawer mobile. */
  onHamburger?: () => void
}

export function TopBar({ showHamburger, onHamburger }: TopBarProps = {}) {
  function openCmdK() {
    // Dispara evento de teclado para abrir CommandPalette
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))
  }

  return (
    <header className={[
      'sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-3 border-b backdrop-blur-xl',
      'bg-white/95 border-slate-200',
      // DARK paridade mockup 01: bg-slate-900/80 simples + border-slate-800
      'dark:border-slate-800',
      'dark:bg-slate-900/80',
    ].join(' ')}>
      {/* Hambúrguer (mobile only) — abre drawer da sidebar */}
      {showHamburger && (
        <button
          type="button"
          onClick={onHamburger}
          aria-label="Abrir menu"
          className={[
            'p-2 rounded-lg shrink-0 transition border',
            'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700',
            'dark:bg-slate-800/50 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-300',
          ].join(' ')}
        >
          <Menu className="w-5 h-5" />
        </button>
      )}

      {/* Search button (paridade mockup — sem título "Dashboard Analítico" no left) */}
      <button
        type="button"
        onClick={openCmdK}
        aria-label="Abrir busca rápida (Cmd+K)"
        className={[
          'flex items-center gap-2 rounded-lg px-3 py-1.5 flex-1 max-w-md border transition group',
          'bg-slate-50 border-slate-200 hover:bg-slate-100',
          'dark:bg-slate-800/50 dark:border-slate-700',
          'dark:hover:border-violet-500/50 dark:hover:bg-slate-800',
        ].join(' ')}
      >
        <Search className="w-4 h-4 text-slate-400 dark:text-slate-400 shrink-0" />
        <span className="bg-transparent text-sm text-slate-500 dark:text-slate-400 outline-none flex-1 text-left">
          Buscar integrador, cliente, site ou câmera…
        </span>
        <kbd className="text-[10px] bg-slate-200 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 rounded px-1.5 py-0.5 border border-slate-300 dark:border-slate-600 font-mono shrink-0">
          ⌘K
        </kbd>
      </button>

      {/* Right cluster — RBAC-aware: cada botão decide internamente se renderiza */}
      <div className="flex items-center gap-2 shrink-0">
        <ImpersonateQuickAccess />
        <QuickAlertsButton />
        <PendingTasksButton />
        <NotificationsBell />
        <UserMenu />
      </div>
    </header>
  )
}
