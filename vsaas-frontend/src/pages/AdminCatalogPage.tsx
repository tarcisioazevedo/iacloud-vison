/**
 * AdminCatalogPage — Catálogo de Módulos da Plataforma.
 * Wrapper rico sobre /modules/catalog. Edição pelo super_admin (M2+).
 */
import { Puzzle } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { ModulosAdminPage } from './ModulosAdminPage'

export function AdminCatalogPage() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-cyan-500/10 via-violet-500/5 to-transparent border-cyan-300 dark:border-cyan-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-500 flex items-center justify-center shadow-lg">
            <Puzzle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Catálogo de Módulos</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Menu do produto: features disponíveis, preço de cada uma, dependências e provisionamento por integrador.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Reusa a página existente — futuramente vira editor próprio */}
      <ModulosAdminPage />
    </div>
  )
}
