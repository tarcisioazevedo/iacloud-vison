// LGPD/log-safety helpers. Use para qualquer campo PII que vá pra logger
// estruturado, métricas, ou resposta de API destinada a operador.
//
// Convenções:
//   - email:   `f***@dominio.com` (1ª letra + domínio)
//   - phone:   `+55 11 ****-1234` (mantém DDI/DDD + últimos 4 dígitos)
//   - retorna string vazia se entrada for null/undefined (não vaza "null")

export function maskEmail(value: string | null | undefined): string {
  if (!value) return ''
  const [local, domain] = value.split('@')
  if (!local || !domain) return '***'
  return `${local.charAt(0)}***@${domain}`
}

export function maskPhone(value: string | null | undefined): string {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return '***'
  const last4 = digits.slice(-4)
  // Tenta preservar DDI+DDD quando o número parece brasileiro (55 + 11 dígitos)
  if (digits.length >= 12 && digits.startsWith('55')) {
    const ddd = digits.slice(2, 4)
    return `+55 ${ddd} ****-${last4}`
  }
  return `****${last4}`
}
