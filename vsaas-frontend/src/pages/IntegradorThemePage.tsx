/**
 * Onda 8 (docs/13-PLAN-COCKPIT-PREMIUM.md) — Theme Builder white-label.
 *
 * Persona: INTEGRADOR_ADMIN (ou SUPER_ADMIN com ?integradorId=X)
 * Rota: /integrador/theme
 *
 * Editor visual com 4 eixos:
 *   8.1 Paleta — primary, accent, success, danger (color pickers + hex)
 *   8.2 Tipografia — Inter / Inter Tight / System
 *   8.3 Densidade — compact / normal / comfortable
 *   8.4 Border radius — soft / square
 *
 * Persistência: PUT /me/integrador/theme (model IntegradorTheme — Onda 8.5/8.6)
 * Aplicação: o portal cliente lê o tema via /me/integrador/theme e injeta CSS
 * vars no <html> (Onda 8.7).
 */
import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Palette, Type, AlignJustify, Square, Save, RotateCcw, Loader2, AlertTriangle,
  CheckCircle2, Eye,
} from 'lucide-react'
import { GlassCard } from '../components/cards/GlassCard'
import { PremiumHero } from '../components/hierarchy'
import {
  useMyIntegradorTheme, updateIntegradorTheme, resetIntegradorTheme,
  formatApiError,
  type IntegradorTheme, type ThemeFontFamily, type ThemeDensity, type ThemeRadius,
} from '../api/client'
import { cn } from '../lib/utils'

const role = typeof window !== 'undefined' ? localStorage.getItem('icv_role') ?? '' : ''
const canEdit = role === 'INTEGRADOR_ADMIN' || role === 'SUPER_ADMIN'

const FONT_OPTIONS: { value: ThemeFontFamily; label: string; sample: string; cssFamily: string }[] = [
  { value: 'inter',       label: 'Inter',       sample: 'AaBb 0123 — moderna, clean',     cssFamily: '"Inter", system-ui, sans-serif' },
  { value: 'inter-tight', label: 'Inter Tight', sample: 'AaBb 0123 — densa, headlines',   cssFamily: '"Inter Tight", "Inter", sans-serif' },
  { value: 'system',      label: 'System UI',   sample: 'AaBb 0123 — nativa do SO',       cssFamily: 'system-ui, -apple-system, sans-serif' },
]

const DENSITY_OPTIONS: { value: ThemeDensity; label: string; desc: string }[] = [
  { value: 'compact',     label: 'Compacto',    desc: 'Mais informação por tela · ideal para operadores' },
  { value: 'normal',      label: 'Normal',      desc: 'Balanceado (padrão)' },
  { value: 'comfortable', label: 'Confortável', desc: 'Espaçamento generoso · acessibilidade' },
]

const RADIUS_OPTIONS: { value: ThemeRadius; label: string; desc: string; px: string }[] = [
  { value: 'soft',   label: 'Suave',    desc: 'Cantos arredondados (12px)', px: '12px' },
  { value: 'square', label: 'Quadrado', desc: 'Cantos retos (2px)',         px: '2px' },
]

const DEFAULTS: Omit<IntegradorTheme, 'integradorId' | 'isDefault'> = {
  primaryColor: '#00C0D0',
  accentColor:  '#8b5cf6',
  successColor: '#10b981',
  dangerColor:  '#f43f5e',
  fontFamily:   'inter',
  density:      'normal',
  radius:       'soft',
}

export function IntegradorThemePage() {
  const { data, error, isLoading, mutate } = useMyIntegradorTheme()
  const [draft, setDraft] = useState<Omit<IntegradorTheme, 'integradorId' | 'isDefault'>>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Sincroniza com o servidor quando o tema chega
  useEffect(() => {
    if (data) {
      setDraft({
        primaryColor: data.primaryColor,
        accentColor:  data.accentColor,
        successColor: data.successColor,
        dangerColor:  data.dangerColor,
        fontFamily:   data.fontFamily,
        density:      data.density,
        radius:       data.radius,
      })
    }
  }, [data])

  const dirty = useMemo(() => {
    if (!data) return false
    return (
      draft.primaryColor !== data.primaryColor ||
      draft.accentColor  !== data.accentColor  ||
      draft.successColor !== data.successColor ||
      draft.dangerColor  !== data.dangerColor  ||
      draft.fontFamily   !== data.fontFamily   ||
      draft.density      !== data.density      ||
      draft.radius       !== data.radius
    )
  }, [draft, data])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const saved = await updateIntegradorTheme(draft)
      await mutate(saved, { revalidate: false })
      setSavedAt(Date.now())
    } catch (e) {
      setSaveError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setSaving(true)
    setSaveError(null)
    try {
      const reset = await resetIntegradorTheme()
      await mutate(reset, { revalidate: false })
      setSavedAt(Date.now())
    } catch (e) {
      setSaveError(formatApiError(e))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
        <span className="ml-2 text-sm text-slate-400">Carregando tema…</span>
      </div>
    )
  }

  if (error) {
    return (
      <GlassCard className="p-5 border-rose-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-rose-300">Falha ao carregar tema</p>
            <p className="text-xs text-slate-400 mt-1">{formatApiError(error)}</p>
          </div>
        </div>
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4">
      <PremiumHero
        emoji="🎨"
        title="Theme Builder"
        subtitle="Personalize cores, tipografia e densidade do portal cliente do seu tenant. Mudanças se aplicam ao portal white-label dos seus clientes finais."
        accent="violet"
        tags={[
          { label: 'White-label', color: 'violet' },
          { label: data?.isDefault ? 'Default VSaaS' : 'Custom', color: data?.isDefault ? 'slate' : 'cyan' },
        ]}
        action={
          canEdit ? (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleReset}
                disabled={saving || data?.isDefault}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-amber-500/50 text-sm text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition"
                title="Reverter para tema padrão VSaaS"
              >
                <RotateCcw className="w-4 h-4" /> Reverter
              </button>
              <button
                onClick={handleSave}
                disabled={!dirty || saving}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 hover:opacity-90 text-white text-sm font-bold shadow-lg shadow-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Salvar
              </button>
            </div>
          ) : null
        }
      />

      {!canEdit && (
        <GlassCard className="p-4 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-300">Acesso somente leitura</p>
              <p className="text-xs text-slate-400 mt-1">
                Apenas <code className="font-mono text-amber-300">INTEGRADOR_ADMIN</code> pode editar o tema.
                Você ainda pode visualizar o tema atual e o preview.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {savedAt && Date.now() - savedAt < 4000 && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <GlassCard className="p-3 border-emerald-500/30 bg-emerald-500/5">
            <div className="flex items-center gap-2 text-emerald-300 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              Tema salvo · aplicado ao portal cliente
            </div>
          </GlassCard>
        </motion.div>
      )}

      {saveError && (
        <GlassCard className="p-4 border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-3 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Falha ao salvar</p>
              <p className="text-slate-400 mt-0.5">{saveError}</p>
            </div>
          </div>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Editor — 3/5 */}
        <div className="lg:col-span-3 space-y-4">
          {/* 8.1 — Paleta */}
          <GlassCard className="p-5">
            <header className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Palette className="w-4 h-4 text-violet-400" /> Paleta
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Cores aplicadas como CSS vars (--icv-primary, --icv-accent, etc.)</p>
              </div>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ColorField label="Primary"  description="ações principais, links, foco" value={draft.primaryColor} onChange={v => setDraft(d => ({ ...d, primaryColor: v }))} disabled={!canEdit} />
              <ColorField label="Accent"   description="destaques, badges, gradientes" value={draft.accentColor}  onChange={v => setDraft(d => ({ ...d, accentColor:  v }))} disabled={!canEdit} />
              <ColorField label="Success"  description="confirmações, status online"   value={draft.successColor} onChange={v => setDraft(d => ({ ...d, successColor: v }))} disabled={!canEdit} />
              <ColorField label="Danger"   description="erros, alertas, deleção"        value={draft.dangerColor}  onChange={v => setDraft(d => ({ ...d, dangerColor:  v }))} disabled={!canEdit} />
            </div>
          </GlassCard>

          {/* 8.2 — Tipografia */}
          <GlassCard className="p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Type className="w-4 h-4 text-violet-400" /> Tipografia
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Família tipográfica do portal</p>
            </header>
            <div className="space-y-2">
              {FONT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDraft(d => ({ ...d, fontFamily: opt.value }))}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition disabled:opacity-60 disabled:cursor-not-allowed',
                    draft.fontFamily === opt.value
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/30 hover:border-violet-500/30',
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-900 dark:text-white" style={{ fontFamily: opt.cssFamily }}>{opt.label}</span>
                    {draft.fontFamily === opt.value && <CheckCircle2 className="w-4 h-4 text-violet-400" />}
                  </div>
                  <p className="text-xs text-slate-400" style={{ fontFamily: opt.cssFamily }}>{opt.sample}</p>
                </button>
              ))}
            </div>
          </GlassCard>

          {/* 8.3 — Densidade */}
          <GlassCard className="p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <AlignJustify className="w-4 h-4 text-violet-400" /> Densidade
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Espaçamento entre elementos da UI</p>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {DENSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDraft(d => ({ ...d, density: opt.value }))}
                  className={cn(
                    'p-3 rounded-lg border text-left transition disabled:opacity-60 disabled:cursor-not-allowed',
                    draft.density === opt.value
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/30 hover:border-violet-500/30',
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{opt.label}</span>
                    {draft.density === opt.value && <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </GlassCard>

          {/* 8.4 — Border radius */}
          <GlassCard className="p-5">
            <header className="mb-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Square className="w-4 h-4 text-violet-400" /> Cantos
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">Arredondamento dos componentes</p>
            </header>
            <div className="grid grid-cols-2 gap-2">
              {RADIUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setDraft(d => ({ ...d, radius: opt.value }))}
                  className={cn(
                    'p-3 border text-left transition disabled:opacity-60 disabled:cursor-not-allowed',
                    draft.radius === opt.value
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/30 hover:border-violet-500/30',
                  )}
                  style={{ borderRadius: opt.value === 'soft' ? '12px' : '2px' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-900 dark:text-white">{opt.label}</span>
                    {draft.radius === opt.value && <CheckCircle2 className="w-3.5 h-3.5 text-violet-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400">{opt.desc}</p>
                </button>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Preview — 2/5 */}
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-4 space-y-3">
            <GlassCard className="p-4">
              <header className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-slate-500 font-bold">
                <Eye className="w-3.5 h-3.5" /> Preview ao vivo
              </header>
              <ThemePreview theme={draft} />
              <p className="text-[10px] text-slate-600 mt-3 leading-relaxed">
                * Preview visual aproximado. As mudanças de tipografia / densidade / radius
                afetam <code>html[data-icv-theme]</code> no portal cliente.
              </p>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Color picker custom ─────────────────────────────────────────────────────
function ColorField({
  label, description, value, onChange, disabled,
}: {
  label: string
  description: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)
  return (
    <div className={cn('p-3 rounded-lg border bg-white dark:bg-slate-900/30 border-slate-300 dark:border-slate-700', disabled && 'opacity-60')}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-slate-900 dark:text-white">{label}</span>
        {!valid && <span className="text-[10px] text-amber-400">hex inválido</span>}
      </div>
      <p className="text-[10px] text-slate-500 mb-2">{description}</p>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className="w-10 h-10 rounded cursor-pointer disabled:cursor-not-allowed border border-slate-300 dark:border-slate-700"
          aria-label={`Cor ${label}`}
        />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`)}
          disabled={disabled}
          maxLength={7}
          spellCheck={false}
          className="flex-1 px-2 py-1.5 rounded bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-violet-500/50 disabled:cursor-not-allowed"
          aria-label={`Hex de ${label}`}
        />
      </div>
    </div>
  )
}

// ─── Preview ──────────────────────────────────────────────────────────────
function ThemePreview({
  theme,
}: {
  theme: Omit<IntegradorTheme, 'integradorId' | 'isDefault'>
}) {
  const fontFamily = FONT_OPTIONS.find(f => f.value === theme.fontFamily)?.cssFamily ?? 'system-ui'
  const radiusPx = theme.radius === 'soft' ? '12px' : '2px'
  const padding = theme.density === 'compact' ? '8px 12px' : theme.density === 'comfortable' ? '20px 24px' : '14px 18px'
  const gap = theme.density === 'compact' ? '8px' : theme.density === 'comfortable' ? '20px' : '12px'

  return (
    <div
      className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800"
      style={{ fontFamily, borderRadius: radiusPx }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {/* Header simulado */}
        <div style={{ padding, borderRadius: radiusPx, background: theme.primaryColor, color: '#fff' }}>
          <div style={{ fontWeight: 700, fontSize: '14px' }}>Portal do Cliente</div>
          <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '2px' }}>Bem-vindo · Acme Shopping</div>
        </div>

        {/* Card primário */}
        <div style={{ padding, borderRadius: radiusPx, background: '#0f172a', border: `1px solid ${theme.primaryColor}33` }}>
          <div style={{ fontSize: '11px', textTransform: 'uppercase', color: theme.primaryColor, fontWeight: 700, letterSpacing: '0.05em' }}>
            Câmeras
          </div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#fff', marginTop: '4px' }}>42</div>
        </div>

        {/* Botões */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            style={{
              padding,
              borderRadius: radiusPx,
              background: theme.primaryColor,
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Ação primária
          </button>
          <button
            type="button"
            style={{
              padding,
              borderRadius: radiusPx,
              background: theme.accentColor,
              color: '#fff',
              fontSize: '12px',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Accent
          </button>
        </div>

        {/* Status badges */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{
            padding: '4px 10px',
            borderRadius: radiusPx,
            fontSize: '11px',
            fontWeight: 600,
            background: `${theme.successColor}26`,
            color: theme.successColor,
            border: `1px solid ${theme.successColor}66`,
          }}>● Online</span>
          <span style={{
            padding: '4px 10px',
            borderRadius: radiusPx,
            fontSize: '11px',
            fontWeight: 600,
            background: `${theme.dangerColor}26`,
            color: theme.dangerColor,
            border: `1px solid ${theme.dangerColor}66`,
          }}>⚠ Crítico</span>
        </div>
      </div>
    </div>
  )
}
