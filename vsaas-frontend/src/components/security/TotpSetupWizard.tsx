/**
 * <TotpSetupWizard> — wizard 3 passos pra configurar 2FA TOTP.
 *
 * 1. Mostra QR code + secret manual
 * 2. Pede 6 dígitos pra verificar
 * 3. Mostra 10 backup codes (single-disclosure) + download
 *
 * Compatível com Google Authenticator, Authy, 1Password, Microsoft Authenticator.
 *
 * Sprint C · docs/40-PLAN-GESTAO-USUARIOS.md
 */
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Shield, Smartphone, Check, Copy, Download, X, AlertTriangle } from 'lucide-react'
import { api } from '../../api/client'
import { useUiToast } from '../Toast'

interface SetupResponse {
  secret: string
  otpauthUrl: string
  expiresInMinutes: number
}

interface VerifyResponse {
  success: boolean
  backupCodes: string[]
  warning: string
}

interface Props {
  onClose: () => void
  onComplete?: () => void
}

export function TotpSetupWizard({ onClose, onComplete }: Props) {
  const toast = useUiToast()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [setup, setSetup] = useState<SetupResponse | null>(null)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startSetup() {
    setLoading(true); setError(null)
    try {
      const { data } = await api.post<SetupResponse>('/me/totp/setup')
      setSetup(data)
      setStep(1)
    } catch (e: any) {
      setError(e.response?.data?.message || 'Erro ao iniciar setup')
    } finally { setLoading(false) }
  }

  // Auto-start (1x no mount). Antes era chamado fora de useEffect — quebrava
  // React 19 strict mode + risco de POSTs duplicados (cada um cria secret
  // pendente novo no cache do backend).
  useEffect(() => { void startSetup() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [])

  async function verifyCode() {
    if (code.length !== 6) return
    setVerifying(true); setError(null)
    try {
      const { data } = await api.post<VerifyResponse>('/me/totp/verify', { code })
      setBackupCodes(data.backupCodes)
      setStep(3)
      toast.success('2FA ativado com sucesso!')
    } catch (e: any) {
      setError(e.response?.data?.message || 'Código inválido')
      setCode('')
    } finally { setVerifying(false) }
  }

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n'))
    toast.success('Códigos copiados')
  }

  function downloadBackupCodes() {
    const content = `VSaaS · Códigos de Backup 2FA\nGerado em: ${new Date().toLocaleString('pt-BR')}\n\nGuarde estes códigos em local seguro. Cada um pode ser usado UMA vez se você perder acesso ao app autenticador.\n\n${backupCodes.join('\n')}`
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vsaas-backup-codes-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleFinish() {
    onComplete?.()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={step === 3 ? undefined : onClose}>
      <div className="bg-slate-900 border-2 border-cyan-500/30 rounded-2xl shadow-2xl max-w-lg w-full p-6 relative" onClick={e => e.stopPropagation()}>
        {step !== 3 && (
          <button onClick={onClose} className="absolute top-3 right-3 w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center text-slate-400">
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Progress */}
        <div className="flex items-center gap-2 mb-6">
          {[1, 2, 3].map(n => (
            <div key={n} className={`flex-1 h-1.5 rounded-full ${step >= n ? 'bg-cyan-500' : 'bg-white/10'}`} />
          ))}
        </div>

        {/* Step 1: QR Code */}
        {step === 1 && setup && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Configurar 2FA</h2>
                <p className="text-xs text-slate-400">Passo 1 de 3 · Escaneie o QR code</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-4">
              Abra seu app autenticador (Google Authenticator, Authy, 1Password) e escaneie:
            </p>

            <div className="bg-white rounded-xl p-4 mb-4 flex items-center justify-center">
              <QRCodeSVG value={setup.otpauthUrl} size={200} level="M" />
            </div>

            <details className="mb-4">
              <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                Não consegue escanear? Digite manualmente
              </summary>
              <div className="mt-2 p-2 rounded-lg bg-white/5 border border-white/10 flex items-center gap-2">
                <code className="text-xs text-cyan-300 font-mono flex-1 break-all">{setup.secret}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(setup.secret); toast.success('Copiado') }}
                  className="p-1.5 rounded hover:bg-white/10"
                  title="Copiar"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                </button>
              </div>
            </details>

            <button onClick={() => setStep(2)} className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold">
              Já escaneei →
            </button>
          </>
        )}

        {/* Step 2: Verify code */}
        {step === 2 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                <Shield className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Verificar código</h2>
                <p className="text-xs text-slate-400">Passo 2 de 3 · Digite os 6 dígitos do app</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-4">
              Digite o código de 6 dígitos que está aparecendo no seu app autenticador agora:
            </p>

            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }}
              className="w-full px-4 py-4 rounded-lg bg-white/5 border-2 border-white/10 focus:border-cyan-500 text-white text-center text-2xl font-mono tracking-widest mb-3"
              placeholder="000000"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) verifyCode() }}
            />

            {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 font-semibold">
                ← Voltar
              </button>
              <button
                onClick={verifyCode}
                disabled={code.length !== 6 || verifying}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {verifying ? 'Verificando...' : 'Verificar →'}
              </button>
            </div>
          </>
        )}

        {/* Step 3: Backup codes */}
        {step === 3 && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <Check className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">2FA ativado!</h2>
                <p className="text-xs text-slate-400">Passo 3 de 3 · Salve seus códigos de backup</p>
              </div>
            </div>

            <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 mb-4 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200 leading-relaxed">
                <strong>Estes códigos serão mostrados APENAS AGORA.</strong> Salve-os em local seguro
                (gerenciador de senhas, papel guardado). Cada um pode ser usado UMA vez se você perder
                acesso ao app autenticador.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4 p-3 rounded-lg bg-white/5 border border-white/10">
              {backupCodes.map((c, i) => (
                <code key={i} className="text-sm text-cyan-300 font-mono text-center py-1">
                  {c}
                </code>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <button onClick={copyBackupCodes} className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/10 flex items-center justify-center gap-1.5">
                <Copy className="w-3.5 h-3.5" /> Copiar todos
              </button>
              <button onClick={downloadBackupCodes} className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/10 flex items-center justify-center gap-1.5">
                <Download className="w-3.5 h-3.5" /> Baixar .txt
              </button>
            </div>

            <button onClick={handleFinish} className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold">
              Salvei os códigos · Concluir
            </button>
          </>
        )}

        {loading && step === 1 && !setup && (
          <p className="text-center text-slate-400 py-8">Carregando...</p>
        )}
        {error && step === 1 && !setup && (
          <p className="text-center text-rose-400 py-8">{error}</p>
        )}
      </div>
    </div>
  )
}
