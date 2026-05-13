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
  fromName:    'VSaaS',
  fromAddress: process.env.SMTP_FROM?.match(/<(.+)>/)?.[1] ?? process.env.SMTP_FROM ?? 'no-reply@iacv.cloud',
}

export const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    name:    'invite',
    label:   'Convite de usuário',
    subject: 'Convite VSaaS',
    body:
      'Olá {{name}},\n\n' +
      '{{inviterName}} convidou você para acessar o VSaaS.\n\n' +
      'Login:  {{loginUrl}}\n' +
      'E-mail: {{email}}\n' +
      'Senha:  {{password}}\n\n' +
      'Após o primeiro acesso, troque sua senha em Configurações > Segurança.\n\n' +
      'Atenciosamente,\nEquipe VSaaS',
  },
  {
    name:    'demo_invite',
    label:   'Convite de demonstração',
    subject: '🚀 Seu acesso ao VSaaS está pronto, {{name}}',
    body:
      'Olá {{name}},\n\n' +
      'Sua demonstração do VSaaS foi criada e está pronta para uso!\n\n' +
      'Empresa: {{companyName}}\n' +
      'Tipo de acesso: {{kind}}\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      '👉 Clique no link abaixo para ativar seu acesso:\n\n' +
      '{{demoUrl}}\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '⏳ Este link é válido por {{expiryDays}} dias (até {{expiresAt}}).\n\n' +
      'Caso tenha dúvidas, entre em contato com nossa equipe comercial.\n\n' +
      'Atenciosamente,\nEquipe VSaaS',
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
      'VSaaS — Monitoramento Inteligente',
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
      'VSaaS — Monitoramento Inteligente',
  },
  {
    name:    'camera_no_upload',
    label:   'Câmera parou de gravar',
    subject: '⚠️ Câmera parou de gravar — {{cameraName}}',
    body:
      'Uma câmera deixou de subir gravações para a nuvem.\n\n' +
      'Câmera:       {{cameraName}}\n' +
      'Site:         {{siteName}}\n' +
      'Cliente:      {{clienteName}}\n' +
      'Box edge:     {{edgeNodeSerial}}\n' +
      'Último upload: {{lastUploadAt}} ({{noUploadDuration}} atrás)\n\n' +
      'A box continua online (heartbeat OK), mas o uploader/ffmpeg parou\n' +
      'ou o RTSP local da câmera caiu. Verifique:\n' +
      ' • Energia / cabo da câmera\n' +
      ' • Logs do agente de gravação na box\n' +
      ' • RTSP da câmera responde no LAN?\n\n' +
      'Painel: {{dashboardUrl}}\n\n' +
      'VSaaS — Monitoramento Inteligente',
  },
  {
    name:    'camera_upload_recovered',
    label:   'Câmera voltou a gravar',
    subject: '✅ Câmera voltou a gravar — {{cameraName}}',
    body:
      'A câmera voltou a subir gravações normalmente.\n\n' +
      'Câmera:       {{cameraName}}\n' +
      'Site:         {{siteName}}\n' +
      'Cliente:      {{clienteName}}\n' +
      'Ficou sem upload por: {{noUploadDuration}}\n' +
      'Recuperada em:        {{recoveredAt}}\n\n' +
      'Painel: {{dashboardUrl}}\n\n' +
      'VSaaS — Monitoramento Inteligente',
  },
  {
    name:    'box_suspended',
    label:   'Box suspensa por inatividade',
    subject: '🚨 Box suspensa por inatividade — {{edgeNodeSerial}}',
    body:
      'Uma Edge Box ficou {{daysWithoutHeartbeat}} dias sem dar sinal de vida\n' +
      'e foi suspensa automaticamente. Enquanto suspensa, ela NÃO pode:\n' +
      ' • Enviar gravações para a nuvem\n' +
      ' • Reportar eventos / heartbeat\n\n' +
      'Box edge:     {{edgeNodeSerial}}\n' +
      'Site:         {{siteName}}\n' +
      'Cliente:      {{clienteName}}\n' +
      'Último heartbeat: {{lastHeartbeatAt}}\n\n' +
      'Para reativar, acesse o painel admin:\n' +
      '{{dashboardUrl}}\n\n' +
      'VSaaS — Monitoramento Inteligente',
  },
  {
    name:    'license_key',
    label:   'Chave de licença Edge Node',
    subject: 'Chave de ativação — {{edgeName}} ({{siteName}})',
    body:
      'Olá,\n\n' +
      'A chave de licença para o Edge Node abaixo foi gerada e está pronta para uso:\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'Edge Node:  {{edgeName}}\n' +
      'Site:       {{siteName}}\n' +
      'Cliente:    {{clienteName}}\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '🔑  CHAVE DE LICENÇA:\n\n' +
      '    {{licenseKey}}\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '⚠️  IMPORTANTE: Esta chave é de uso único para este equipamento.\n' +
      '   Não a compartilhe. Configure no terminal da Box:\n\n' +
      '   export IACV_LICENSE_KEY="{{licenseKey}}"\n' +
      '   docker compose restart iacv-box\n\n' +
      'Após a ativação, o Edge Node aparecerá como ONLINE no painel:\n' +
      '{{dashboardUrl}}\n\n' +
      'Em caso de dúvidas, consulte a documentação de instalação:\n' +
      '{{docsUrl}}\n\n' +
      'Atenciosamente,\nEquipe VSaaS',
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
      'VSaaS — CRM Interno',
  },
  // ───────────────────────────────────────────────────────────────────────
  // Fluxo de DEMO — emails para o LEAD (não para admins)
  // ───────────────────────────────────────────────────────────────────────
  {
    name:    'lead_confirmation',
    label:   'Confirmação de cadastro de demo (para o lead)',
    subject: '✅ Recebemos seu cadastro · IACloud Vision',
    body:
      'Olá {{contactName}},\n\n' +
      'Recebemos seu cadastro para conhecer a IACloud Vision e agradecemos o interesse!\n\n' +
      '━━━ Resumo do que você nos enviou ━━━\n' +
      'Nome:       {{contactName}}\n' +
      'Email:      {{contactEmail}}\n' +
      '{{phoneRow}}' +
      '{{companyRow}}' +
      '{{cameraRow}}' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '⏱ PRÓXIMOS PASSOS\n\n' +
      'Nossa equipe comercial analisará seu cadastro em até 1 (um) dia útil. \n' +
      'Após a aprovação, você receberá um email com:\n' +
      '  • Link de acesso à plataforma demo\n' +
      '  • Credenciais temporárias\n' +
      '  • Tutorial rápido de primeiros passos\n\n' +
      'Se precisar de algo urgente, fale conosco:\n' +
      '  📧 {{supportEmail}}\n' +
      '  📱 {{supportWhatsapp}}\n\n' +
      'Atenciosamente,\nEquipe IACloud Vision\n\n' +
      '---\n' +
      'IACloud Vision · VSaaS · IA · Analytics\n' +
      '{{publicSiteUrl}}',
  },
  {
    name:    'lead_demo_approved',
    label:   'Demo aprovada (envio do magic link)',
    subject: '🎉 Sua demo IACloud Vision está pronta!',
    body:
      'Olá {{contactName}},\n\n' +
      'Boas notícias! Sua solicitação foi aprovada e você já pode acessar a demo:\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '🔗 LINK DE ACESSO:\n\n' +
      '   {{magicLink}}\n\n' +
      '⏰ Validade: {{ttlDays}} dias\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      '📚 PRIMEIROS PASSOS:\n\n' +
      '  1. Clique no link acima — login automático, sem senha\n' +
      '  2. Adicione câmeras IP de teste em "Câmeras"\n' +
      '  3. Configure gatilhos de IA em "Gatilhos IA"\n' +
      '  4. Veja o resultado em tempo real em "Eventos"\n\n' +
      '🎓 TUTORIAL EM VÍDEO: {{tutorialUrl}}\n\n' +
      '💬 PRECISA DE AJUDA?\n' +
      '  Nossa equipe está disponível em:\n' +
      '  📧 {{supportEmail}}\n' +
      '  📱 {{supportWhatsapp}}\n\n' +
      'Aproveite e nos diga o que achou!\n\n' +
      'Atenciosamente,\nEquipe IACloud Vision\n\n' +
      '---\n' +
      'IACloud Vision · VSaaS · IA · Analytics\n' +
      '{{publicSiteUrl}}',
  },
  {
    name:    'lead_demo_rejected',
    label:   'Demo rejeitada (com cordialidade)',
    subject: 'Sobre seu cadastro · IACloud Vision',
    body:
      'Olá {{contactName}},\n\n' +
      'Agradecemos seu interesse em conhecer a IACloud Vision.\n\n' +
      'No momento, nossa equipe avaliou que ainda não conseguimos atender ao seu perfil específico ' +
      'com a demo padrão. {{reasonRow}}\n\n' +
      'Mas isso não é um "não" definitivo! Se quiser, podemos:\n' +
      '  • Agendar uma conversa rápida para entender melhor sua necessidade\n' +
      '  • Conectar você a um integrador parceiro da sua região\n' +
      '  • Manter contato sobre futuras versões e features\n\n' +
      'Fale conosco quando quiser:\n' +
      '  📧 {{supportEmail}}\n' +
      '  📱 {{supportWhatsapp}}\n\n' +
      'Atenciosamente,\nEquipe IACloud Vision\n\n' +
      '---\n' +
      'IACloud Vision · VSaaS · IA · Analytics\n' +
      '{{publicSiteUrl}}',
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
      'VSaaS — Monitoramento Inteligente',
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
