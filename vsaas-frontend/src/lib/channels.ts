/**
 * Channels — abre apps nativos (tel:, mailto:, whatsapp://) com templates
 * pré-preenchidos baseados no contexto do lead.
 *
 * Filosofia: o vendedor não tem que copiar/colar nada. Clica → app abre →
 * conversa começa. Atividade é registrada AUTOMATICAMENTE no servidor.
 */
import { api } from '../api/client'

// Sanitiza telefone para padrão E.164 (whatsapp://, tel://) — assume Brasil se < 13 dígitos.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = String(raw).replace(/\D+/g, '')
  if (!digits) return null
  // Se já tem +55 ou 55 + 11 dígitos, mantém. Se tem 10/11 dígitos, prepende 55.
  if (digits.length === 13 && digits.startsWith('55')) return digits
  if (digits.length === 12 && digits.startsWith('55')) return digits
  if (digits.length === 11) return '55' + digits
  if (digits.length === 10) return '55' + digits
  return digits
}

// ─── Templates por contexto ─────────────────────────────────────────────────
// Tudo que vai pra produção sai daqui. Editar em UM lugar muda em todos os
// pontos onde os botões de canal aparecem (Drawer, Card, Pipeline action bar).

interface LeadCtx {
  contactName: string
  companyName?: string | null
  status?: string
  kind?: string
}

export function whatsappTemplate(lead: LeadCtx): string {
  const first = (lead.contactName ?? '').split(' ')[0] || 'Olá'
  const company = lead.companyName ? ` na ${lead.companyName}` : ''
  switch (lead.status) {
    case 'NEW':
      return `Olá ${first}! Aqui é da VSaaS. Vi que você se cadastrou no nosso site${company}. Tem 5 minutos para conversarmos sobre como podemos ajudar?`
    case 'CONTACTED':
      return `Oi ${first}, retomando nosso contato${company}. Posso enviar a demo da plataforma agora?`
    case 'DEMO_SENT':
      return `Olá ${first}, conseguiu acessar a demo${company}? Posso esclarecer alguma dúvida?`
    case 'NEGOTIATION':
      return `Oi ${first}, tudo certo${company}? Vamos agendar 15min para fechar os últimos pontos da proposta?`
    default:
      return `Olá ${first}! Aqui é da VSaaS${company}.`
  }
}

export function emailTemplate(lead: LeadCtx): { subject: string; body: string } {
  const first = (lead.contactName ?? '').split(' ')[0] || 'olá'
  const company = lead.companyName ?? 'sua empresa'
  switch (lead.status) {
    case 'NEW':
      return {
        subject: `VSaaS — primeira conversa, ${company}`,
        body: `Olá ${first},\n\nVi seu cadastro na nossa plataforma. Sou da VSaaS, plataforma de VMS Cloud B2B.\n\nGostaria de entender o cenário atual de monitoramento da ${company} e mostrar onde podemos somar.\n\nTem 15 minutos esta semana?\n\nAbraços,`,
      }
    case 'DEMO_SENT':
      return {
        subject: `Demo VSaaS — ficou alguma dúvida, ${first}?`,
        body: `Olá ${first},\n\nEnviei o acesso à demo essa semana. Conseguiu navegar?\n\nSe quiser, podemos agendar uma chamada de 20 minutos para eu apresentar pessoalmente os módulos que mais fazem sentido para a ${company}.\n\nAbraços,`,
      }
    case 'NEGOTIATION':
      return {
        subject: `Próximos passos — proposta VSaaS`,
        body: `Olá ${first},\n\nVi que ainda há alguns pontos em aberto na proposta.\n\nQuer agendar 15min para alinhar e finalizarmos esta semana?\n\nAbraços,`,
      }
    default:
      return {
        subject: `VSaaS — ${company}`,
        body: `Olá ${first},\n\nQuero retomar nosso contato.\n\nAbraços,`,
      }
  }
}

// ─── Aberturas de canal (links) ────────────────────────────────────────────

export function openWhatsapp(lead: LeadCtx & { contactPhone?: string | null }) {
  const phone = normalizePhone(lead.contactPhone)
  if (!phone) { alert('Lead sem telefone cadastrado.'); return }
  const text = encodeURIComponent(whatsappTemplate(lead))
  // wa.me funciona em desktop e mobile e abre WhatsApp Web ou app conforme contexto.
  window.open(`https://wa.me/${phone}?text=${text}`, '_blank', 'noopener,noreferrer')
}

export function openCall(lead: LeadCtx & { contactPhone?: string | null }) {
  const phone = normalizePhone(lead.contactPhone)
  if (!phone) { alert('Lead sem telefone cadastrado.'); return }
  // tel: funciona em mobile direto; em desktop tenta sistema (Skype, FaceTime, etc).
  window.location.href = `tel:+${phone}`
}

export function openEmail(lead: LeadCtx & { contactEmail?: string | null }) {
  if (!lead.contactEmail) { alert('Lead sem email cadastrado.'); return }
  const tpl = emailTemplate(lead)
  const subject = encodeURIComponent(tpl.subject)
  const body = encodeURIComponent(tpl.body)
  window.location.href = `mailto:${lead.contactEmail}?subject=${subject}&body=${body}`
}

// ─── Auto-log de atividade ─────────────────────────────────────────────────
// Chamado depois de abrir o canal — registra que o vendedor pelo menos TENTOU
// a interação. Backend cria SalesActivity + bumpa goal de CALLS/EMAILS quando aplicável.

export async function logChannelAttempt(leadId: string, channel: 'CALL' | 'EMAIL' | 'WHATSAPP', note?: string) {
  try {
    await api.post(`/leads/${leadId}/follow-ups`, {
      type: channel,
      content: note || `Tentativa via ${channel} aberta no app nativo.`,
      dueDate: null,
    })
  } catch {
    // Silent: o vendedor já abriu o canal. Falha de log não deve bloquear UX.
  }
}
