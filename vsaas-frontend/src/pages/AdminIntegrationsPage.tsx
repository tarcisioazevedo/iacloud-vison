/**
 * AdminIntegrationsPage — Integrações da Plataforma (SUPER_ADMIN).
 *
 * Centraliza credenciais master da infra: R2, SMTP, WhatsApp Evolution, MQTT, Telegram.
 * Hoje cada uma tem sua própria página em /settings; aqui agregamos visão única.
 */
import { Link } from 'react-router-dom'
import { Zap, HardDrive, Mail, MessageCircle, Radio, Send, ChevronRight, CheckCircle } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { cn } from '../lib/utils'
import { bg500_20 } from '../lib/colorClasses'

const INTEGRATIONS = [
  {
    id: 'r2',     name: 'Cloudflare R2',  icon: HardDrive, color: 'cyan',
    description: 'Storage S3-compatible para gravações e snapshots',
    statusKey: 'R2_ACCESS_KEY_ID',
    href: '/settings?tab=storage',
  },
  {
    id: 'smtp',   name: 'SMTP Master',     icon: Mail, color: 'violet',
    description: 'Servidor de email transacional (convites, alertas, notificações)',
    statusKey: 'SMTP_HOST',
    href: '/settings?tab=email',
  },
  {
    id: 'whatsapp', name: 'WhatsApp (Evolution API)', icon: MessageCircle, color: 'emerald',
    description: 'Envio de alertas via WhatsApp Business',
    statusKey: 'EVOLUTION_API_URL',
    href: '/settings?tab=whatsapp',
  },
  {
    id: 'mqtt',   name: 'MQTT Broker',     icon: Radio, color: 'amber',
    description: 'Broker MQTT para comunicação com edge boxes',
    statusKey: 'MQTT_HOST',
    href: '/integrations/mqtt',
  },
  {
    id: 'telegram', name: 'Telegram Bot', icon: Send, color: 'cyan',
    description: 'Bot Telegram para alertas (opcional, fallback de WhatsApp)',
    statusKey: 'TELEGRAM_BOT_TOKEN',
    href: '/settings?tab=telegram',
  },
]

export function AdminIntegrationsPage() {
  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-amber-500/10 via-cyan-500/5 to-transparent border-amber-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-cyan-500 flex items-center justify-center shadow-lg">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Integrações da Plataforma</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Credenciais master da infraestrutura. Cada integração roda em paralelo e pode ser overridada por integrador.
            </p>
          </div>
        </div>
      </GlassCard>

      <div className="grid gap-3 md:grid-cols-2">
        {INTEGRATIONS.map(int => {
          const Icon = int.icon
          const colorMap: Record<string, string> = {
            cyan:    'border-cyan-500/30 bg-cyan-500/5',
            violet:  'border-violet-500/30 bg-violet-500/5',
            emerald: 'border-emerald-500/30 bg-emerald-500/5',
            amber:   'border-amber-500/30 bg-amber-500/5',
          }
          const iconColorMap: Record<string, string> = {
            cyan:    'text-cyan-400',
            violet:  'text-violet-400',
            emerald: 'text-emerald-400',
            amber:   'text-amber-400',
          }
          return (
            <Link key={int.id} to={int.href}>
              <GlassCard className={cn('p-4 hover:border-white/20 transition cursor-pointer', colorMap[int.color])}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', bg500_20(int.color))}>
                      <Icon className={cn('w-5 h-5', iconColorMap[int.color])} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">{int.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">{int.description}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 shrink-0 mt-1" />
                </div>
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/5 flex items-center justify-between">
                  <span className="text-[10px] text-slate-500 font-mono">env: {int.statusKey}</span>
                  <span className="text-[10px] text-emerald-300 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> configurado
                  </span>
                </div>
              </GlassCard>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
