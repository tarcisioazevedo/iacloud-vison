/**
 * <CapabilityBlockedView> — tela completa que substitui o conteúdo
 * da página quando o cliente não tem a capability necessária.
 *
 * Diferente do toast (que aparece após erro 402), este componente é
 * proativo: mostra ANTES do cliente tentar a ação, dentro do conteúdo
 * principal, explicando o que falta e oferecendo o produto correto.
 *
 * Uso (na própria página):
 *   if (!hasCapability) return <CapabilityBlockedView cap={CAP.STORAGE_PLAYBACK_TIMELINE} />
 *
 * Ou (via wrapper):
 *   <RequireCapability cap={CAP.X} mode="upgrade">
 *     <PageContent />
 *   </RequireCapability>
 *
 * Fonte: docs/35-AUDIT (Pacote C.2) + docs/36-QA (Cenário 1)
 */
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { Lock, Zap, ArrowRight, ExternalLink, Mail } from 'lucide-react'
import { api } from '../api/client'

interface Props {
  /** Capability que está faltando (ex: 'storage.playback.timeline') */
  cap: string
  /**
   * Texto custom pro topo. Se omitido, gera baseado na capability.
   * Ex: "Gravação em nuvem não está contratada"
   */
  title?: string
  /**
   * Texto custom pro corpo. Se omitido, gera baseado na capability.
   * Ex: "Suas câmeras estão transmitindo ao vivo mas não estão sendo gravadas."
   */
  description?: string
  /** Ícone alternativo (default: 🔒) */
  icon?: React.ComponentType<{ className?: string }>
  /** Esconde botão "Ver outros planos" (default: false) */
  hideAlternatives?: boolean
}

interface ProductResponse {
  capability: string
  product: {
    id: string
    slug: string
    name: string
    tagline?: string | null
    description?: string | null
    category: string
    basePriceBrl: number
    comingSoon: boolean
    features: string[]
  } | null
  alternatives: Array<{
    id: string
    slug: string
    name: string
    basePriceBrl: number
  }>
  suggestion?: string
  marketplaceUrl: string
}

/**
 * Mapeia capability → texto amigável quando não passado via props.
 * Mantém consistência de copy entre as várias páginas que usam o componente.
 */
const CAP_COPY: Record<string, { title: string; description: string }> = {
  'storage.playback.timeline': {
    title: 'Gravação em nuvem não está contratada',
    description: 'Suas câmeras estão transmitindo ao vivo, mas as imagens não estão sendo armazenadas. Para revisar o que aconteceu, contrate um plano de gravação.',
  },
  'storage.recording.continuous': {
    title: 'Gravação contínua não está ativa',
    description: 'Para gravar 24/7 e revisar qualquer momento, contrate um plano de armazenamento HD ou FHD.',
  },
  'storage.export.bulk': {
    title: 'Exportação em massa requer plano avançado',
    description: 'Para baixar várias gravações de uma vez em um arquivo ZIP, contrate um plano com export bulk.',
  },
  'ai.semantic.create_rule': {
    title: 'Alertas Semânticos IA não estão contratados',
    description: 'Para criar regras de alerta com linguagem natural ("pessoa sem capacete", "carro na via"), contrate Alertas Semânticos IA.',
  },
  'ai.detection.basic': {
    title: 'Detecção IA não está ativa',
    description: 'Para detectar pessoas, veículos e objetos automaticamente, contrate o plano de Detecção IA.',
  },
  'ai.lpr.read_plate': {
    title: 'Reconhecimento de Placas (LPR) não contratado',
    description: 'Para ler placas de veículos automaticamente e manter lista branca/negra, contrate o plano LPR.',
  },
  'ai.fr.search_face': {
    title: 'Reconhecimento Facial não contratado',
    description: 'Para indexar e buscar pessoas por reconhecimento facial, contrate o plano de Face Recognition.',
  },
  'ai.heatmap.generate': {
    title: 'Mapa de Calor não está ativo',
    description: 'Para visualizar fluxo de pessoas em mapa de calor e relatórios, contrate o plano Heatmap.',
  },
  'timelapse.generate.daily': {
    title: 'Timelapse não está contratado',
    description: 'Para gerar vídeos timelapse comprimindo horas em segundos, contrate o plano Timelapse.',
  },
  'ptz.control': {
    title: 'Controle PTZ não disponível neste plano',
    description: 'Para controlar pan/tilt/zoom das câmeras remotamente, contrate o módulo PTZ.',
  },
  'audio.talkback': {
    title: 'Áudio Talkback não disponível',
    description: 'Para falar pelas câmeras (intercomunicador), contrate o módulo de Áudio Talkback.',
  },
}

function defaultCopy(cap: string): { title: string; description: string } {
  return CAP_COPY[cap] || {
    title: 'Esta funcionalidade requer assinatura',
    description: 'Para acessar este recurso, contrate o plano correspondente no Marketplace.',
  }
}

export function CapabilityBlockedView({
  cap,
  title,
  description,
  icon: Icon = Lock,
  hideAlternatives = false,
}: Props) {
  const navigate = useNavigate()
  const { data, isLoading } = useSWR<ProductResponse>(
    `/me/capabilities/product-for/${encodeURIComponent(cap)}`,
    async (url: string) => {
      const { data } = await api.get(url)
      return data
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 300_000,   // 5min cache
    },
  )

  const copy = title || description
    ? { title: title || '', description: description || '' }
    : defaultCopy(cap)

  const product = data?.product
  const alternatives = data?.alternatives ?? []

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-xl w-full">
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-orange-500/5 to-transparent backdrop-blur-sm p-8 shadow-2xl shadow-amber-500/10">
          {/* Ícone + título */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/40 flex items-center justify-center mb-4">
              <Icon className="w-8 h-8 text-amber-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-100 mb-2">
              {copy.title}
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              {copy.description}
            </p>
          </div>

          {/* Produto recomendado */}
          {isLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 animate-pulse">
              <div className="h-4 bg-white/10 rounded w-1/3 mb-2" />
              <div className="h-3 bg-white/10 rounded w-2/3" />
            </div>
          ) : product ? (
            <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 p-5 mb-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-xl shrink-0">
                  {product.category === 'STORAGE' ? '📦'
                    : product.category === 'AI' ? '🧠'
                    : product.category === 'TIMELAPSE' ? '🎬'
                    : '⚡'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">
                    {product.category}
                  </div>
                  <div className="text-base font-bold text-white">{product.name}</div>
                  {product.tagline && (
                    <div className="text-xs text-slate-400">{product.tagline}</div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-slate-500">a partir de</div>
                  <div className="text-lg font-bold text-cyan-400">
                    R$ {product.basePriceBrl.toFixed(0)}<span className="text-xs text-slate-500 font-normal">/mês</span>
                  </div>
                </div>
              </div>

              {product.features.length > 0 && (
                <ul className="space-y-1 mb-4">
                  {product.features.slice(0, 3).map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                      <Zap className="w-3 h-3 text-cyan-400 mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={() => navigate(`/marketplace?suggest=${encodeURIComponent(cap)}&autoOpen=1`)}
                disabled={product.comingSoon}
                className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {product.comingSoon ? (
                  <>Em breve <Mail className="w-4 h-4" /></>
                ) : (
                  <>Contratar {product.name} <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          ) : (
            // Sem produto mapeado (capability nova ou restrita)
            <div className="rounded-xl border border-slate-500/30 bg-slate-800/50 p-4 mb-4 text-center">
              <p className="text-sm text-slate-400">
                {data?.suggestion || 'Entre em contato com seu integrador para ativar este recurso.'}
              </p>
            </div>
          )}

          {/* Botões secundários */}
          <div className="flex items-center gap-2">
            {!hideAlternatives && alternatives.length > 0 && (
              <button
                onClick={() => navigate('/marketplace')}
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/10 transition flex items-center justify-center gap-1.5"
              >
                Ver outros planos <ExternalLink className="w-3 h-3" />
              </button>
            )}
            {!hideAlternatives && alternatives.length === 0 && product && (
              <button
                onClick={() => navigate('/marketplace')}
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/10 transition flex items-center justify-center gap-1.5"
              >
                Ver Marketplace completo <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Capability técnica pra debug (só dev) */}
          {import.meta.env.DEV && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <code className="text-[10px] text-slate-600 font-mono">
                cap: {cap}
              </code>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
