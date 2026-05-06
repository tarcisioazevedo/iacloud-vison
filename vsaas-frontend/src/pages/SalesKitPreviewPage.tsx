/**
 * SalesKitPreviewPage — renderiza um material em layout print-friendly.
 *
 * Routes:
 *   /sales-kit/preview/institutional   → deck institucional 6 páginas
 *   /sales-kit/preview/technical       → deck técnico 5 páginas
 *   /sales-kit/preview/vertical/:slug  → caso vertical 4 páginas
 *
 * Aplica tema do integrador (cores+logo) automaticamente via useApplyIntegradorTheme.
 * Usuário aperta "Imprimir/Salvar PDF" — browser converte usando @media print CSS.
 */
import { useParams, useNavigate } from 'react-router-dom'
import { Printer, ArrowLeft, Download, Eye } from 'lucide-react'
import { useMyWhitelabel } from '../api/client'
import { VERTICALS, PLATFORM_HIGHLIGHTS, COMPETITIVE_DELTA } from '../lib/sales-kit-content'
import { cn } from '../lib/utils'
import './SalesKitPreviewPage.css'

export function SalesKitPreviewPage() {
  const params = useParams<{ type: string; slug?: string }>()
  const navigate = useNavigate()
  const { data: wl } = useMyWhitelabel()

  const type = params.type ?? 'institutional'
  const vertical = type === 'vertical' && params.slug ? VERTICALS.find(v => v.slug === params.slug) : null

  const integrador = {
    name: wl?.tradeName ?? wl?.name ?? 'IA Cloud Vision',
    logo: wl?.logoUrl ?? null,
    email: wl?.email ?? 'comercial@iacloud.com.br',
    phone: wl?.phone ?? '',
    website: wl?.website ?? '',
  }

  return (
    <>
      {/* Toolbar — escondida na impressão */}
      <div className="sticky top-0 z-50 bg-slate-900 text-white px-6 py-3 flex items-center justify-between shadow-lg print-hide">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/me/sales-kit')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/20 hover:bg-white/10 text-xs">
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
          <span className="text-sm">
            <Eye className="w-3.5 h-3.5 inline mr-1" />
            Preview · marca: <strong>{integrador.name}</strong>
          </span>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-xs font-semibold">
          <Printer className="w-3.5 h-3.5" /> Imprimir / Salvar PDF
        </button>
      </div>

      <div className="sales-kit-deck bg-slate-50 dark:bg-slate-900 min-h-screen py-8">
        {type === 'institutional' && <InstitutionalDeck integrador={integrador} />}
        {type === 'technical' && <TechnicalDeck integrador={integrador} />}
        {type === 'vertical' && vertical && <VerticalDeck integrador={integrador} vertical={vertical} />}
        {type === 'vertical' && !vertical && (
          <div className="max-w-4xl mx-auto p-12 text-center">
            <p className="text-slate-500">Vertical não encontrado.</p>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Deck Institucional ────────────────────────────────────────────────
function InstitutionalDeck({ integrador }: { integrador: any }) {
  return (
    <>
      <Slide cover>
        <div className="text-center">
          {integrador.logo
            ? <img src={integrador.logo} alt={integrador.name} className="h-20 mx-auto mb-8 object-contain" />
            : <div className="text-2xl font-bold text-cyan-700 mb-8">{integrador.name}</div>}
          <h1 className="text-5xl font-bold text-slate-900 mb-4">VMS Cloud com IA</h1>
          <p className="text-2xl text-slate-600 mb-8">A plataforma de monitoramento inteligente que reduz custos e aumenta segurança</p>
          <div className="text-sm text-slate-500 mt-16">Apresentação institucional · {new Date().getFullYear()}</div>
        </div>
      </Slide>

      <Slide title="O problema" integrador={integrador}>
        <div className="grid grid-cols-2 gap-8 mt-8">
          <div>
            <h3 className="text-xl font-bold text-slate-900 mb-4">Câmeras hoje:</h3>
            <ul className="space-y-3 text-slate-700">
              {['Apenas gravam — não avisam', 'NVR isolado, sem visibilidade remota', 'Suporte humano 24/7 caro', 'Sem dados pra decisão (BI)', 'Vulnerável a roubo do próprio NVR'].map(p => (
                <li key={p} className="flex gap-2"><span className="text-rose-500">✗</span><span>{p}</span></li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900 mb-4">VMS Cloud com IA:</h3>
            <ul className="space-y-3 text-slate-700">
              {['Detecção em tempo real (LPR, face, EPI...)', 'Acesso remoto seguro (qualquer dispositivo)', 'Alertas automáticos por evento', 'Dashboards e relatórios prontos', 'Gravação encriptada na cloud'].map(p => (
                <li key={p} className="flex gap-2"><span className="text-emerald-500">✓</span><span>{p}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </Slide>

      <Slide title="Diferenciais técnicos" integrador={integrador}>
        <div className="grid grid-cols-2 gap-6 mt-8">
          {PLATFORM_HIGHLIGHTS.map(h => (
            <div key={h.label} className="p-6 rounded-xl border-2 border-cyan-200 bg-cyan-50">
              <p className="text-xl font-bold text-slate-900 mb-2">{h.label}</p>
              <p className="text-slate-600">{h.desc}</p>
            </div>
          ))}
        </div>
      </Slide>

      <Slide title="vs concorrentes" integrador={integrador}>
        <table className="w-full mt-8 border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="text-left p-4 font-bold border-b-2 border-slate-300">Característica</th>
              <th className="text-left p-4 font-bold border-b-2 border-slate-300 text-cyan-700">Nossa solução</th>
              <th className="text-left p-4 font-bold border-b-2 border-slate-300 text-slate-500">Concorrentes</th>
            </tr>
          </thead>
          <tbody>
            {COMPETITIVE_DELTA.map(c => (
              <tr key={c.feature} className="border-b border-slate-200">
                <td className="p-4 font-semibold text-slate-900">{c.feature}</td>
                <td className="p-4 text-emerald-700 font-bold">{c.ours}</td>
                <td className="p-4 text-slate-500 line-through">{c.theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Slide>

      <Slide title="Arquitetura" integrador={integrador}>
        <div className="mt-8">
          <pre className="text-sm text-slate-700 leading-relaxed bg-slate-50 p-6 rounded-lg border border-slate-200 font-mono whitespace-pre-wrap">
{`Câmeras IP (RTSP/ONVIF)
        ↓
Edge Box (gravação local + IA YOLO) ← OPCIONAL
        ↓
Cloud Vault (R2/S3, encriptado)
        ↓
IA Cloud (Vertex AI: face, LPR, PPE, semântica)
        ↓
Dashboard Web + Mobile + API REST/Webhook`}
          </pre>
        </div>
        <p className="mt-6 text-sm text-slate-600 text-center">Funciona com qualquer câmera ONVIF/RTSP. Sem trocar hardware.</p>
      </Slide>

      <Slide cover>
        <div className="text-center">
          <h2 className="text-4xl font-bold text-slate-900 mb-8">Próximos passos</h2>
          <div className="space-y-6 text-xl text-slate-700 mb-12">
            <div className="flex items-center justify-center gap-3"><span className="w-10 h-10 rounded-full bg-cyan-600 text-white font-bold flex items-center justify-center">1</span><span>Análise técnica do seu parque atual</span></div>
            <div className="flex items-center justify-center gap-3"><span className="w-10 h-10 rounded-full bg-cyan-600 text-white font-bold flex items-center justify-center">2</span><span>Trial gratuito 14 dias / 5 câmeras</span></div>
            <div className="flex items-center justify-center gap-3"><span className="w-10 h-10 rounded-full bg-cyan-600 text-white font-bold flex items-center justify-center">3</span><span>POC validada em até 30 dias</span></div>
            <div className="flex items-center justify-center gap-3"><span className="w-10 h-10 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center">4</span><span>Go-live com suporte dedicado</span></div>
          </div>
          <div className="border-t border-slate-300 pt-8 text-slate-700">
            <p className="text-2xl font-bold">{integrador.name}</p>
            {integrador.email && <p className="mt-2">{integrador.email}</p>}
            {integrador.phone && <p>{integrador.phone}</p>}
            {integrador.website && <p className="text-cyan-700">{integrador.website}</p>}
          </div>
        </div>
      </Slide>
    </>
  )
}

// ─── Deck Técnico ────────────────────────────────────────────────────
function TechnicalDeck({ integrador }: { integrador: any }) {
  return (
    <>
      <Slide cover>
        <div className="text-center">
          {integrador.logo && <img src={integrador.logo} alt={integrador.name} className="h-20 mx-auto mb-8" />}
          <h1 className="text-5xl font-bold text-slate-900 mb-4">Apresentação Técnica</h1>
          <p className="text-2xl text-slate-600">Arquitetura, segurança e integrações</p>
          <div className="text-sm text-slate-500 mt-16">{integrador.name} · {new Date().getFullYear()}</div>
        </div>
      </Slide>

      <Slide title="Pipeline de IA" integrador={integrador}>
        <div className="mt-6 space-y-4">
          <p className="text-slate-700">3 pipelines paralelos por câmera, escolhidos por tipo de detecção:</p>
          <div className="grid grid-cols-3 gap-4 mt-6">
            <div className="p-5 rounded-lg bg-cyan-50 border-2 border-cyan-300">
              <p className="font-bold text-cyan-800">Cloud Vision</p>
              <p className="text-xs text-slate-600 mt-2">Face annotation, sentimentos, labels</p>
              <p className="text-xs text-slate-500 mt-1">Pay-per-call · Latência 800ms</p>
            </div>
            <div className="p-5 rounded-lg bg-violet-50 border-2 border-violet-300">
              <p className="font-bold text-violet-800">Vertex AI</p>
              <p className="text-xs text-slate-600 mt-2">PPE, occupancy, busca semântica</p>
              <p className="text-xs text-slate-500 mt-1">Pay-per-hour · Latência 200ms</p>
            </div>
            <div className="p-5 rounded-lg bg-emerald-50 border-2 border-emerald-300">
              <p className="font-bold text-emerald-800">Edge YOLOv8</p>
              <p className="text-xs text-slate-600 mt-2">LPR, contagem, tracking local</p>
              <p className="text-xs text-slate-500 mt-1">Edge box · Latência 50ms · 0 quota</p>
            </div>
          </div>
        </div>
      </Slide>

      <Slide title="Segurança e LGPD" integrador={integrador}>
        <div className="mt-8 grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3">Encriptação</h3>
            <ul className="space-y-2 text-sm text-slate-700">
              <li>✓ AES-256 em repouso (R2/S3)</li>
              <li>✓ TLS 1.3 em trânsito</li>
              <li>✓ JWT com rotação de chave</li>
              <li>✓ Tokens edge isolados por dispositivo</li>
            </ul>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-3">LGPD</h3>
            <ul className="space-y-2 text-sm text-slate-700">
              <li>✓ DSAR self-serve (export + erasure)</li>
              <li>✓ Audit log imutável de TODOS acessos</li>
              <li>✓ Data residency: BR (sa-east-1)</li>
              <li>✓ Retenção configurável por câmera</li>
            </ul>
          </div>
        </div>
      </Slide>

      <Slide title="Integrações" integrador={integrador}>
        <div className="mt-8 grid grid-cols-3 gap-4">
          {[
            { title: 'API REST', desc: 'OpenAPI 3.1 · Bearer JWT' },
            { title: 'Webhooks', desc: 'Events: camera.online, event.detected, ...' },
            { title: 'MQTT', desc: 'Pub/Sub para IoT integrado' },
            { title: 'Telegram', desc: 'Bot nativo, alerts em tempo real' },
            { title: 'WhatsApp', desc: 'Evolution API + templates aprovados' },
            { title: 'Email', desc: 'SMTP próprio ou template padrão' },
          ].map(i => (
            <div key={i.title} className="p-4 rounded-lg border-2 border-slate-200 bg-white">
              <p className="font-bold text-slate-900">{i.title}</p>
              <p className="text-xs text-slate-600 mt-1">{i.desc}</p>
            </div>
          ))}
        </div>
      </Slide>

      <Slide cover>
        <div className="text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-6">Detalhes técnicos completos</h2>
          <p className="text-xl text-slate-600 mb-12">Documentação técnica e API reference disponíveis sob demanda.</p>
          <div className="border-t border-slate-300 pt-8 text-slate-700">
            <p className="text-2xl font-bold">{integrador.name}</p>
            <p className="mt-2">{integrador.email}</p>
          </div>
        </div>
      </Slide>
    </>
  )
}

// ─── Deck Vertical (caso de uso) ────────────────────────────────────
function VerticalDeck({ integrador, vertical }: { integrador: any; vertical: any }) {
  return (
    <>
      <Slide cover>
        <div className="text-center">
          {integrador.logo && <img src={integrador.logo} alt={integrador.name} className="h-16 mx-auto mb-6" />}
          <div className="text-7xl mb-4">{vertical.emoji}</div>
          <h1 className="text-5xl font-bold text-slate-900 mb-3">VMS para {vertical.title}</h1>
          <p className="text-xl text-slate-600 mb-12">{vertical.subtitle}</p>
          <div className="text-sm text-slate-500">{integrador.name} · Caso de uso vertical</div>
        </div>
      </Slide>

      <Slide title={`Desafios em ${vertical.title}`} integrador={integrador}>
        <div className="mt-8 space-y-3">
          {vertical.painPoints.map((p: string) => (
            <div key={p} className="flex items-start gap-3 p-4 rounded-lg bg-rose-50 border border-rose-200">
              <span className="text-rose-600 font-bold mt-0.5">!</span>
              <span className="text-slate-700">{p}</span>
            </div>
          ))}
        </div>
      </Slide>

      <Slide title="Como resolvemos" integrador={integrador}>
        <div className="mt-8 grid grid-cols-2 gap-4">
          {vertical.solutions.map((s: string) => (
            <div key={s} className="p-5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-3">
              <span className="text-emerald-600 font-bold mt-0.5 text-2xl">✓</span>
              <span className="text-slate-700">{s}</span>
            </div>
          ))}
        </div>
      </Slide>

      <Slide title="Cases reais" integrador={integrador}>
        <div className="mt-6 space-y-6">
          {vertical.cases.map((c: any, idx: number) => (
            <div key={idx} className="p-6 rounded-xl border-2 border-cyan-200 bg-cyan-50">
              <p className="font-bold text-slate-900 mb-2">{c.client}</p>
              <p className="text-sm text-slate-700 mb-2"><strong>Contexto:</strong> {c.context}</p>
              <p className="text-sm text-slate-700 mb-3"><strong>Solução:</strong> {c.result}</p>
              <p className="text-emerald-700 font-bold">📊 {c.metric}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-slate-600 italic">{vertical.roiHint}</p>
      </Slide>

      <Slide cover>
        <div className="text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-6">Vamos conversar?</h2>
          <p className="text-lg text-slate-600 mb-8">Trial de 14 dias com 5 câmeras. Zero compromisso.</p>
          <div className="border-t border-slate-300 pt-8 text-slate-700">
            <p className="text-2xl font-bold">{integrador.name}</p>
            <p className="mt-2">{integrador.email}</p>
            {integrador.phone && <p>{integrador.phone}</p>}
          </div>
        </div>
      </Slide>
    </>
  )
}

// ─── Slide primitive ────────────────────────────────────────────────
function Slide({ children, title, integrador, cover }: { children: any; title?: string; integrador?: any; cover?: boolean }) {
  return (
    <div className="sales-kit-slide max-w-5xl mx-auto bg-white shadow-2xl rounded-lg p-12 mb-6 print:mb-0 print:shadow-none print:rounded-none print:p-16">
      {!cover && (
        <header className="flex items-center justify-between mb-8 pb-4 border-b-2 border-slate-200">
          {title && <h2 className="text-3xl font-bold text-slate-900">{title}</h2>}
          {integrador?.logo
            ? <img src={integrador.logo} alt={integrador.name} className="h-10 object-contain" />
            : <span className="text-sm font-bold text-slate-500">{integrador?.name}</span>}
        </header>
      )}
      <div className={cn(cover ? 'flex items-center justify-center min-h-[600px]' : '')}>
        {children}
      </div>
      {!cover && (
        <footer className="mt-8 pt-4 border-t border-slate-200 text-xs text-slate-500 flex justify-between">
          <span>{integrador?.name}</span>
          <span>Confidencial</span>
        </footer>
      )}
    </div>
  )
}
