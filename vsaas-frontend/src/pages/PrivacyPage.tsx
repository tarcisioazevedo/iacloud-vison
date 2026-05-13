import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock, ChevronLeft, Shield } from 'lucide-react'

const LAST_UPDATED = 'Abril de 2026'

const SECTIONS = [
  { id: 'intro', title: '1. Introdução', content: `A VSaaS LTDA ("ICV", "nós") está comprometida com a privacidade e a proteção dos dados pessoais de seus Usuários, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).\n\nEsta Política descreve como coletamos, utilizamos, armazenamos e protegemos os dados pessoais no contexto da Plataforma VSaaS de visão computacional.` },
  { id: 'lgpd', title: '2. Base Legal e Conceitos LGPD', content: `A LGPD regula o tratamento de dados pessoais por pessoas físicas e jurídicas no Brasil. Entende-se por:\n\n• Tratamento: qualquer operação com dados pessoais (coleta, armazenamento, uso, compartilhamento, eliminação).\n• Dados Pessoais: informações que identificam ou tornam identificável uma pessoa natural.\n• Dados Sensíveis: dados biométricos, de saúde, origem racial, opinião política, entre outros — com proteção reforçada.\n• Controlador: quem decide sobre o tratamento dos dados.\n• Operador: quem trata dados por determinação do Controlador.\n• Encarregado (DPO): canal de comunicação entre a ICV e titulares/ANPD.` },
  { id: 'coleta', title: '3. Dados Coletados', content: `A ICV coleta os seguintes dados para prestação dos Serviços:\n\n• Dados cadastrais: nome, e-mail, telefone, CNPJ/CPF do Integrador e Usuários.\n• Dados de acesso: logs de login, IP, dispositivo, navegador, horário.\n• Conteúdo do Usuário: streaming de vídeo, imagens e metadados enviados pelas câmeras.\n• Dados de uso: funcionalidades acessadas, alertas gerados, configurações aplicadas.\n• Dados de navegação: cookies de sessão e analytics de desempenho da Plataforma.\n\nDados de Clientes Finais (imagens de câmeras) são tratados pela ICV como Operadora, sendo o Integrador o Controlador responsável.` },
  { id: 'finalidade', title: '4. Finalidades do Tratamento', content: `Os dados são tratados para:\n\n• Prestação dos Serviços contratados (recepção de vídeo, gravação, analytics de IA).\n• Autenticação e controle de acesso seguro à Plataforma.\n• Faturamento, cobrança e gestão contratual.\n• Suporte técnico e atendimento ao Usuário.\n• Melhoria contínua dos modelos de IA internos (imagens anonimizadas).\n• Cumprimento de obrigações legais e regulatórias.\n• Atendimento a ordens judiciais e requisições de autoridades competentes.` },
  { id: 'base-legal', title: '5. Base Legal', content: `Os tratamentos realizados pela ICV se baseiam em:\n\n• Execução de contrato: dados necessários para prestação do serviço contratado.\n• Obrigação legal: cumprimento de legislações aplicáveis.\n• Legítimo interesse: segurança da Plataforma, prevenção a fraudes e melhoria dos Serviços.\n• Consentimento: quando aplicável, especialmente para comunicações de marketing.` },
  { id: 'retencao', title: '6. Retenção e Eliminação', content: `• Dados cadastrais e operacionais: mantidos durante a vigência contratual + 5 anos após rescisão (para fins legais).\n• Gravações de vídeo: mantidas pelo período contratado; eliminadas automaticamente ao expirar ou no cancelamento da câmera.\n• Logs de acesso: 6 meses, conforme o Marco Civil da Internet.\n• Dados de faturamento: 5 anos, conforme legislação fiscal.\n\nApós os prazos, os dados são eliminados de forma segura e definitiva.` },
  { id: 'compartilhamento', title: '7. Compartilhamento de Dados', content: `A ICV não vende dados pessoais. Os dados podem ser compartilhados com:\n\n• Provedores de infraestrutura (armazenamento S3, CDN): sujeitos a contratos de confidencialidade e conformidade com a LGPD.\n• Autoridades públicas: mediante ordem judicial ou requisição legal fundamentada.\n• Integradores: no contexto da gestão de seus Clientes Finais, conforme o contrato.\n\nTransferências internacionais de dados ocorrem apenas para países com nível de proteção adequado ou mediante garantias contratuais específicas (cláusulas-padrão LGPD).` },
  { id: 'seguranca', title: '8. Segurança dos Dados', content: `A ICV adota medidas técnicas e administrativas para proteger os dados:\n\n• Criptografia de dados em trânsito (TLS 1.3) e em repouso (AES-256).\n• Acesso ao banco de dados restrito por IP e autenticação multifatorial.\n• Isolamento de dados por tenant (multi-tenancy seguro).\n• Monitoramento contínuo de acessos e anomalias.\n• Senhas dos Usuários armazenadas em hash — a ICV não tem acesso a senhas em texto plano.\n• Revisões periódicas de segurança e testes de penetração.` },
  { id: 'cookies', title: '9. Cookies e Rastreamento', content: `A Plataforma utiliza cookies essenciais para autenticação e sessão, cookies analíticos para melhoria de desempenho (dados agregados e anonimizados) e possivelmente pixels de rastreamento em e-mails de comunicação.\n\nO Usuário pode desativar cookies não essenciais nas configurações do navegador, o que pode afetar algumas funcionalidades da Plataforma.` },
  { id: 'direitos', title: '10. Direitos dos Titulares', content: `Conforme a LGPD (arts. 17 a 22), os titulares têm direito a:\n\n• Confirmação de existência de tratamento e acesso aos dados.\n• Correção de dados incompletos ou desatualizados.\n• Anonimização, bloqueio ou eliminação de dados desnecessários.\n• Portabilidade para outro fornecedor.\n• Informação sobre compartilhamento com terceiros.\n• Revogação de consentimento, quando aplicável.\n• Oposição a tratamentos realizados sem consentimento.\n\nSolicitações devem ser enviadas para: privacidade@iacloudvision.com.br. Respondemos em até 15 dias úteis.` },
  { id: 'dpo', title: '11. Encarregado de Dados (DPO)', content: `O Encarregado de Proteção de Dados da VSaaS pode ser contatado pelo e-mail: privacidade@iacloudvision.com.br\n\nTambém é possível registrar reclamações perante a Autoridade Nacional de Proteção de Dados (ANPD) em: www.gov.br/anpd` },
  { id: 'atualizacao', title: '12. Atualização desta Política', content: `Esta Política pode ser atualizada periodicamente. Alterações substanciais serão comunicadas por e-mail e/ou notificação na Plataforma. A continuidade de uso após notificação implica concordância com a versão atualizada.\n\nÚltima atualização: Abril de 2026.` },
]

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-900" style={{ fontFamily: "'Inter', sans-serif" }}>
      <nav className="sticky top-0 z-30 bg-white dark:bg-space-800/80 backdrop-blur border-b border-slate-200 dark:border-white/10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/login" className="flex items-center gap-1.5 text-slate-500 hover:text-cyan-600 transition-colors text-sm">
              <ChevronLeft className="w-4 h-4"/> Voltar
            </Link>
            <span className="text-slate-600 dark:text-slate-300 dark:text-white/20">|</span>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-cyan-600"/>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Política de Privacidade</span>
            </div>
          </div>
          <span className="text-xs text-slate-400">Atualizado em {LAST_UPDATED}</span>
        </div>
      </nav>

      <div className="py-16 px-6 text-white" style={{ background: 'linear-gradient(135deg, #0B1629 0%, #0e2a50 50%, #0369a1 100%)' }}>
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-cyan-400"/>
              <span className="text-cyan-400 text-sm font-semibold uppercase tracking-widest">Conformidade LGPD</span>
            </div>
            <h1 className="text-4xl font-extrabold mb-3">Política de Privacidade</h1>
            <p className="text-slate-600 dark:text-slate-300 max-w-2xl">Como coletamos, usamos e protegemos seus dados pessoais na Plataforma VSaaS.</p>
            <p className="text-slate-500 text-sm mt-4">Última atualização: {LAST_UPDATED}</p>
          </motion.div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 flex gap-12">
        <aside className="hidden xl:block w-64 shrink-0">
          <div className="sticky top-20 bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-4 shadow-sm">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3">Índice</p>
            <nav className="space-y-1">
              {SECTIONS.map(s => (
                <a key={s.id} href={`#${s.id}`} className="block text-xs text-slate-500 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 rounded-lg px-2 py-1.5 transition-all truncate">
                  {s.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <main className="flex-1 min-w-0 space-y-6">
          {SECTIONS.map((s, i) => (
            <motion.section
              key={s.id}
              id={s.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-white dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10 p-8 shadow-sm"
            >
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-cyan-50 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                {s.title.replace(/^\d+\.\s/, '')}
              </h2>
              <div className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed space-y-2">
                {s.content.split('\n').map((line, li) =>
                  line.startsWith('• ') ? (
                    <div key={li} className="flex gap-2"><span className="text-cyan-500 dark:text-cyan-400 shrink-0 mt-0.5">•</span><span>{line.slice(2)}</span></div>
                  ) : <p key={li}>{line}</p>
                )}
              </div>
            </motion.section>
          ))}

          <div className="bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/30 rounded-2xl p-6 text-center">
            <Lock className="w-6 h-6 text-cyan-600 dark:text-cyan-400 mx-auto mb-2"/>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Privacidade e Proteção de Dados</p>
            <p className="text-xs text-slate-500">DPO / Encarregado: <a href="mailto:privacidade@iacloudvision.com.br" className="text-cyan-600 dark:text-cyan-400 hover:underline">privacidade@iacloudvision.com.br</a></p>
            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-400">
              <Link to="/terms" className="hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors">Termos de Uso</Link>
              <span>·</span>
              <Link to="/login" className="hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors">Voltar ao Login</Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
