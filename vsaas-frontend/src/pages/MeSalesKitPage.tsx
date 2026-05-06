/**
 * MeSalesKitPage — Hub de materiais de venda do integrador.
 *
 * Cards:
 *   - Decks (Institucional + Técnico)
 *   - 6 verticais com casos de uso
 *   - ROI Calculator
 *   - Email templates copiáveis
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, FileText, Calculator, Mail, ExternalLink, Copy, Check, Star } from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { useMyWhitelabel } from '../api/client'
import { VERTICALS, EMAIL_TEMPLATES } from '../lib/sales-kit-content'
import { cn } from '../lib/utils'

export function MeSalesKitPage() {
  const { data: wl } = useMyWhitelabel()
  const integradorName = wl?.tradeName ?? wl?.name ?? 'IA Cloud Vision'

  return (
    <div className="space-y-4">
      <GlassCard className="p-5 bg-gradient-to-br from-amber-500/10 via-cyan-500/5 to-transparent border-amber-500/20">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-cyan-500 flex items-center justify-center shadow-lg">
            <Briefcase className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Sales Kit</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
              Material de venda <strong>white-labeled com sua marca</strong> ({integradorName}).
              Apresentações, casos de uso, calculadora de ROI e templates de email.
              Imprime/salva como PDF direto do navegador.
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Decks principais */}
      <section>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500" /> Apresentações principais
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <DeckCard
            title="Apresentação Institucional"
            subtitle="6 slides · cobertura geral da plataforma"
            description="Use no primeiro contato com prospect. Cobre problema, solução, diferenciais, comparativo vs concorrentes, arquitetura e próximos passos."
            href="/sales-kit/preview/institutional"
            tone="cyan"
          />
          <DeckCard
            title="Apresentação Técnica"
            subtitle="5 slides · arquitetura, segurança, integrações"
            description="Use com CTOs, gerentes de TI ou compradores técnicos. Pipeline de IA, encriptação/LGPD, integrações disponíveis (REST, MQTT, Webhooks)."
            href="/sales-kit/preview/technical"
            tone="violet"
          />
        </div>
      </section>

      {/* ROI Calculator */}
      <section>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-emerald-500" /> Ferramenta de fechamento
        </h2>
        <DeckCard
          title="Calculadora de ROI"
          subtitle="Estima economia anual + payback"
          description="Use ao vivo na reunião com o prospect. Inputs: nº câmeras, custo atual, perda estimada. Output: economia mensal, redução de perdas, benefício anual, payback."
          href="/me/sales-kit/roi"
          tone="emerald"
          icon={Calculator}
        />
      </section>

      {/* Verticais */}
      <section>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
          Casos de uso por vertical
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {VERTICALS.map(v => (
            <Link
              key={v.slug}
              to={`/sales-kit/preview/vertical/${v.slug}`}
              className="block group"
            >
              <GlassCard className="p-4 hover:border-cyan-400 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-3xl">{v.emoji}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-500" />
                </div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">{v.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{v.subtitle}</p>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-3 line-clamp-2">
                  {v.painPoints[0]}
                </p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-2 italic">
                  💡 {v.roiHint}
                </p>
              </GlassCard>
            </Link>
          ))}
        </div>
      </section>

      {/* Email templates */}
      <section>
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
          <Mail className="w-4 h-4 text-cyan-500" /> Templates de email
        </h2>
        <div className="space-y-3">
          {EMAIL_TEMPLATES.map(t => <EmailCard key={t.id} template={t} integradorName={integradorName} />)}
        </div>
      </section>
    </div>
  )
}

function DeckCard({ title, subtitle, description, href, tone, icon: Icon = FileText }: {
  title: string; subtitle: string; description: string
  href: string; tone: 'cyan' | 'violet' | 'emerald'
  icon?: any
}) {
  return (
    <Link to={href} className="block group">
      <GlassCard className={cn(
        'p-5 hover:scale-[1.01] transition-all',
        tone === 'cyan' && 'border-cyan-500/30 bg-cyan-500/[0.02]',
        tone === 'violet' && 'border-violet-500/30 bg-violet-500/[0.02]',
        tone === 'emerald' && 'border-emerald-500/30 bg-emerald-500/[0.02]',
      )}>
        <div className="flex items-start gap-4">
          <div className={cn(
            'w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
            tone === 'cyan' && 'bg-cyan-500/15',
            tone === 'violet' && 'bg-violet-500/15',
            tone === 'emerald' && 'bg-emerald-500/15',
          )}>
            <Icon className={cn(
              'w-5 h-5',
              tone === 'cyan' && 'text-cyan-700 dark:text-cyan-400',
              tone === 'violet' && 'text-violet-700 dark:text-violet-400',
              tone === 'emerald' && 'text-emerald-700 dark:text-emerald-400',
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-slate-900 dark:text-white">{title}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{subtitle}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 line-clamp-3">{description}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-cyan-500 shrink-0" />
        </div>
      </GlassCard>
    </Link>
  )
}

function EmailCard({ template, integradorName }: { template: any; integradorName: string }) {
  const [copied, setCopied] = useState(false)

  const filled = template.body.replace(/\[INTEGRADOR_NOME\]/g, integradorName)

  function copy() {
    navigator.clipboard.writeText(`Assunto: ${template.subject}\n\n${filled}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{template.title}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Assunto: <code>{template.subject}</code></p>
        </div>
        <button onClick={copy} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-700 dark:text-cyan-400 text-xs font-semibold hover:bg-cyan-500/10">
          {copied ? <><Check className="w-3.5 h-3.5" />Copiado!</> : <><Copy className="w-3.5 h-3.5" />Copiar</>}
        </button>
      </div>
      <details className="mt-2">
        <summary className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer">Ver corpo do email</summary>
        <pre className="mt-2 p-3 rounded bg-slate-50 dark:bg-space-800/60 border border-slate-200 dark:border-white/10 text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap font-sans leading-relaxed">
{filled}
        </pre>
      </details>
    </GlassCard>
  )
}
