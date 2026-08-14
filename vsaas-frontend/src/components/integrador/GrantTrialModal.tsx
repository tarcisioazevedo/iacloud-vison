/**
 * GrantTrialModal — modal usado pelo integrador para conceder um trial
 * de produto do marketplace a um cliente final SEU.
 *
 * Backend: POST /me/integrador/subscription-trials/grant
 *   Validação de tenant ownership feita lá (cliente deve ser do integrador).
 *
 * UX:
 *  - Recebe clienteFinalId fixo (vem de quem chama, ex: ClientesFinaisPage)
 *  - Lista produtos do marketplace (catálogo do integrador) com trialDays default
 *  - Permite override de duração + campanha pra analytics
 *  - Após sucesso, dispara onCreated() pra parent atualizar lista
 *
 * Fonte: docs/35-AUDIT-CONSISTENCIA-E2E.md (Trial System cascata)
 */
import { useState } from 'react'
import useSWR from 'swr'
import { RefreshCw, Sparkles } from 'lucide-react'
import { api } from '../../api/client'

interface Product {
  id: string
  name: string
  slug: string
  category: 'STORAGE' | 'AI' | 'TIMELAPSE' | 'ADDON'
  tagline?: string | null
  trialDays?: number
  allowSelfTrial?: boolean
}

const fetcher = (url: string) => api.get(url).then(r => r.data)

interface Props {
  clienteFinalId: string
  clienteName?: string
  onClose: () => void
  onCreated?: (subscriptionId: string) => void
}

export function GrantTrialModal({ clienteFinalId, clienteName, onClose, onCreated }: Props) {
  const { data: productsData, isLoading } = useSWR<{ products: Product[] }>(
    '/marketplace/products?includeComingSoon=false',
    fetcher,
  )
  const products = productsData?.products ?? []

  const [productId, setProductId] = useState('')
  const [customDays, setCustomDays] = useState<number | ''>('')
  const [campaign, setCampaign] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const selected = products.find(p => p.id === productId)
  const effectiveDays = customDays !== '' ? Number(customDays) : (selected?.trialDays ?? 14)

  async function save() {
    if (!productId) { setErr('Escolha um produto'); return }
    setBusy(true); setErr(null)
    try {
      const r = await api.post('/me/integrador/subscription-trials/grant', {
        clienteFinalId,
        productId,
        customDurationDays: customDays === '' ? undefined : Number(customDays),
        campaign: campaign || undefined,
      })
      onCreated?.(r.data.id)
      onClose()
    } catch (e: any) {
      const code = e?.response?.data?.error
      if (code === 'already_has_subscription') {
        setErr('Esse cliente já tem assinatura ativa desse produto.')
      } else if (code === 'cliente_not_in_tenant') {
        setErr('Cliente não pertence ao seu integrador.')
      } else if (code === 'product_inactive') {
        setErr('Produto está desativado.')
      } else {
        setErr(code ?? e.message ?? 'Falha ao conceder trial.')
      }
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-md mt-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-cyan-500" />
            Conceder trial
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900 text-xl leading-none">×</button>
        </div>
        {clienteName && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Para: <strong className="text-slate-700 dark:text-slate-300">{clienteName}</strong></p>
        )}

        {isLoading && <p className="text-xs text-slate-500">Carregando produtos…</p>}

        {!isLoading && (
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Produto do marketplace</label>
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className="w-full input-base"
              >
                <option value="">— escolha um produto —</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.category}) · {p.trialDays ?? 14}d default
                  </option>
                ))}
              </select>
              {selected?.tagline && (
                <p className="text-[11px] text-slate-500 mt-1">{selected.tagline}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Dias (opcional)</label>
                <input
                  type="number" min={1} max={90} value={customDays}
                  onChange={e => setCustomDays(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder={String(selected?.trialDays ?? 14)}
                  className="w-full input-base"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Campanha</label>
                <input
                  type="text" value={campaign}
                  onChange={e => setCampaign(e.target.value)}
                  placeholder="ex: piloto-q1"
                  className="w-full input-base"
                />
              </div>
            </div>
            <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/30 p-2.5 text-[11px] text-cyan-700 dark:text-cyan-300">
              O trial dura <strong>{effectiveDays} dia{effectiveDays === 1 ? '' : 's'}</strong>.
              Após esse período, a assinatura cai pra CANCELED automaticamente
              e o cliente deixa de ter acesso às capabilities do produto.
            </div>
          </div>
        )}

        {err && <div className="mt-3 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-300 dark:border-white/10 text-xs">Cancelar</button>
          <button
            onClick={save}
            disabled={busy || !productId}
            className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-semibold"
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin inline" /> : 'Conceder trial'}
          </button>
        </div>
      </div>
    </div>
  )
}
