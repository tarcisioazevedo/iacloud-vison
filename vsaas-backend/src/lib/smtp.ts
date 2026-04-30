/**
 * smtp.ts — Shared SMTP utilities.
 *
 * • loadSmtp()      — lê configuração do SystemConfig (DB), fallback p/ .env.
 * • loadTemplate()  — lê template de email do SystemConfig, fallback p/ padrão.
 * • renderTemplate()— substitui {{variáveis}} no body/subject.
 * • sendMail()      — wrapper nodemailer com a config carregada.
 *
 * Importado por:
 *   - routes/email-config.ts  (gestão SMTP via API)
 *   - routes/users.ts         (envio de convite de usuário)
 *   - routes/demo-invites.ts  (futuramente: envio do magic-link)
 */

import { prisma } from './prisma'
import { logger } from './logger'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface SmtpConfig {
  host:        string
  port:        number
  secure:      boolean
  user:        string
  pass:        string
  fromName:    string
  fromAddress: string
}

export interface EmailTemplate {
  name:    string
  label:   string
  subject: string
  body:    string
}

// ── Defaults (lidos do .env na inicialização) ─────────────────────────────────

export const DEFAULT_SMTP: SmtpConfig = {
  host:        process.env.SMTP_HOST        ?? '',
  port:        Number(process.env.SMTP_PORT ?? 587),
  secure:      process.env.SMTP_SECURE === 'true',
  user:        process.env.SMTP_USER        ?? '',
  pass:        process.env.SMTP_PASS        ?? '',
  fromName:    'IA Cloud Vision',
  fromAddress: process.env.SMTP_FROM?.match(/<(.+)>/)?.[1] ?? process.env.SMTP_FROM ?? 'no-reply@iacv.cloud',
}

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    name:    'invite',
    label:   'Convite de usuário',
    subject: 'Convite IA Cloud Vision',
    body:
      'Olá {{name}},\n\n' +
      '{{inviterName}} convidou você para acessar o IA Cloud Vision.\n\n' +
      'Login:  {{loginUrl}}\n' +
      'E-mail: {{email}}\n' +
      'Senha:  {{password}}\n\n' +
      'Após o primeiro acesso, troque sua senha em Configurações > Segurança.\n\n' +
      'Atenciosamente,\nEquipe IA Cloud Vision',
  },
  {
    name:    'demo_invite',
    label:   'Convite de demonstração',
    subject: '🚀 Seu acesso ao IA Cloud Vision está pronto, {{name}}',
    body:
      'Olá {{name}},\n\n' +
      'Sua demonstração do IA Cloud Vision foi criada e está pronta para uso!\n\n' +
      'Empresa: {{companyName}}\n' +
      'Tipo de acesso: {{kind}}\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '👉 Clique no link abaixo para ativar seu acesso:\n\n' +
      '{{demoUrl}}\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '⏳ Este link é válido por {{expiryDays}} dias (até {{expiresAt}}).\n\n' +
      'Caso tenha dúvidas, entre em contato com nossa equipe comercial.\n\n' +
      'Atenciosamente,\nEquipe IA Cloud Vision',
  },
  {
    name:    'alert',
    label:   'Alerta de câmera',
    subject: '[{{severity}}] Alerta detectado — {{cameraName}}',
    body:
      'Câmera: {{cameraName}}\n' +
      'Local:  {{location}}\n' +
      'Evento: {{eventType}}\n' +
      'Hora:   {{timestamp}}\n\n' +
      '{{description}}\n\n' +
      'Acesse o painel: {{dashboardUrl}}\n',
  },
  {
    name:    'camera_down',
    label:   'Câmera offline',
    subject: '🔴 [{{severity}}] Câmera offline — {{cameraName}}',
    body:
      'Uma câmera sob sua supervisão ficou offline.\n\n' +
      'Câmera:   {{cameraName}}\n' +
      'Local:    {{location}}\n' +
      'Site:     {{siteName}}\n' +
      'Cliente:  {{clienteName}}\n' +
      'Offline desde: {{offlineSince}}\n' +
      'Duração:  {{offlineDuration}}\n\n' +
      '{{escaladeNote}}' +
      'Verifique a câmera no painel:\n{{dashboardUrl}}\n\n' +
      '---\nPara gerenciar alertas: {{settingsUrl}}\n' +
      'IA Cloud Vision — Monitoramento Inteligente',
  },
  {
    name:    'camera_up',
    label:   'Câmera recuperada',
    subject: '✅ Câmera recuperada — {{cameraName}}',
    body:
      'A câmera voltou a operar normalmente.\n\n' +
      'Câmera:       {{cameraName}}\n' +
      'Local:        {{location}}\n' +
      'Site:         {{siteName}}\n' +
      'Ficou offline por: {{downDuration}}\n' +
      'Recuperada em:     {{recoveredAt}}\n\n' +
      'Acesse o painel:\n{{dashboardUrl}}\n\n' +
      'IA Cloud Vision — Monitoramento Inteligente',
  },
  {
    name:    'lead_notification',
    label:   'Notificação de novo lead',
    subject: '🔔 Novo lead: {{contactName}} — {{companyName}}',
    body:
      'Um novo lead foi registrado no funil comercial.\n\n' +
      'Nome:     {{contactName}}\n' +
      'E-mail:   {{contactEmail}}\n' +
      'Empresa:  {{companyName}}\n' +
      'Tipo:     {{kind}}\n' +
      'Origem:   {{source}}\n' +
      '{{cameraVolumeRow}}' +
      '{{messageRow}}' +
      '\nAcesse o funil de leads:\n{{leadsUrl}}\n\n' +
      'IA Cloud Vision — CRM Interno',
  },
  {
    name:    'alert_digest',
    label:   'Resumo diário de alertas',
    subject: '📊 Resumo de alertas — {{clienteName}} — {{date}}',
    body:
      'Resumo do período {{periodStart}} → {{periodEnd}}\n\n' +
      '🔴 Críticos:  {{countCritical}} evento(s)\n' +
      '🟡 Avisos:    {{countWarning}} evento(s)\n' +
      'ℹ️  Info:      {{countInfo}} evento(s)\n\n' +
      '━━━ Câmeras com falha ━━━\n{{cameraDownList}}\n\n' +
      '━━━ Triggers disparados ━━━\n{{triggerList}}\n\n' +
      'Ver histórico completo:\n{{dashboardUrl}}\n\n' +
      '---\nPara gerenciar alertas: {{settingsUrl}}\n' +
      'IA Cloud Vision — Monitoramento Inteligente',
  },
]

// ── Loaders ──────────────────────────────────────────────────────────────────

/**
 * Carrega configuração SMTP do banco (SystemConfig key = "smtp_config").
 * Se não houver entrada, usa variáveis de ambiente como fallback.
 */
export async function loadSmtp(): Promise<SmtpConfig> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: 'smtp_config' } })
    if (!row) return DEFAULT_SMTP
    const saved = JSON.parse(row.value) as Partial<SmtpConfig>
    return { ...DEFAULT_SMTP, ...saved }
  } catch {
    return DEFAULT_SMTP
  }
}

/**
 * Carrega template de email do banco. Fallback para DEFAULT_TEMPLATES.
 */
export async function loadTemplate(name: string): Promise<EmailTemplate | undefined> {
  const def = DEFAULT_TEMPLATES.find(t => t.name === name)
  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: `email_tpl_${name}` } })
    if (!row) return def
    const saved = JSON.parse(row.value) as Partial<EmailTemplate>
    return def ? { ...def, ...saved } : undefined
  } catch {
    return def
  }
}

// ── Template rendering ────────────────────────────────────────────────────────

/**
 * Substitui {{variavel}} no texto pelo valor correspondente.
 * Variáveis sem correspondência ficam como estão (não apaga silenciosamente).
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => vars[key] ?? match)
}

// ── sendMail ─────────────────────────────────────────────────────────────────

export interface SendMailOptions {
  to:      string
  subject: string
  text:    string
  html?:   string
}

/**
 * Envia um email usando a configuração SMTP armazenada no DB (ou .env).
 * Falha silenciosa: nunca lança — retorna { sent, reason }.
 */
export async function sendMail(opts: SendMailOptions): Promise<{ sent: boolean; reason?: string }> {
  const cfg = await loadSmtp()

  if (!cfg.host || !cfg.user) {
    return { sent: false, reason: 'SMTP não configurado' }
  }

  try {
    const nodemailer: any = await import('nodemailer').catch(() => null)
    if (!nodemailer) return { sent: false, reason: 'nodemailer não instalado' }

    const transporter = nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.user, pass: cfg.pass },
      tls:    { rejectUnauthorized: false },
      connectionTimeout: 10_000,
    })

    await transporter.sendMail({
      from:    `"${cfg.fromName}" <${cfg.fromAddress}>`,
      to:      opts.to,
      subject: opts.subject,
      text:    opts.text,
      ...(opts.html ? { html: opts.html } : {}),
    })

    logger.info({ to: opts.to, subject: opts.subject }, 'smtp_send_ok')
    return { sent: true }
  } catch (err: any) {
    logger.warn({ err: err.message, to: opts.to }, 'smtp_send_failed')
    return { sent: false, reason: err.message ?? 'Falha SMTP' }
  }
}
