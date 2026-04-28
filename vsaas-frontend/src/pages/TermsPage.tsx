import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { FileText, ChevronLeft, Shield } from 'lucide-react'

const LAST_UPDATED = 'Abril de 2026'

const SECTIONS = [
  { id: 'intro', title: '1. Quem somos', content: `A IA Cloud Vision LTDA ("nós") desenvolve e mantém uma plataforma SaaS de visão computacional para integradores de segurança eletrônica e seus clientes finais. Ao acessar a Plataforma, você ("Usuário") concorda integralmente com estes Termos. Se usar em nome de uma empresa, declara possuir poderes para vinculá-la.` },
  { id: 'definicoes', title: '2. Definições', content: `• Integrador: empresa de segurança eletrônica que contrata a Plataforma.\n• Cliente Final: beneficiário dos serviços gerenciados pelo Integrador.\n• Usuário: pessoa que acessa a Plataforma por credenciais próprias.\n• Conteúdo do Usuário: streaming de vídeo, imagens e metadados enviados.\n• Serviços: recepção de vídeo (RTMP/ONVIF), armazenamento em nuvem, reconhecimento facial, LPR, busca semântica e analytics.` },
  { id: 'funcionamento', title: '3. Funcionamento da Plataforma', content: `A Plataforma permite recepção de câmeras IP via RTMP/ONVIF, armazenamento isolado por tenant (S3), acesso a vídeo ao vivo e gravações, análise por IA (LPR, facial, heatmap, EPI) e portal white-label via Magic Link. Funcionalidades variam conforme o plano contratado.` },
  { id: 'faturamento', title: '4. Faturamento', content: `Cobrança mensal (1° ao último dia), vencimento no dia 15 seguinte. Pro-rata no primeiro mês a partir da ativação. Câmera ativa = ao menos uma conexão bem-sucedida. Atraso: 5 dias → bloqueio; 10 dias → suspensão; 30 dias → rescisão + protesto. Multa de 2% + juros de 1%/mês.` },
  { id: 'obrigacoes-icv', title: '5. Obrigações da IA Cloud Vision', content: `Manter a Plataforma funcional, realizar manutenções, proteger dados conforme LGPD (Lei 13.709/2018) e Marco Civil (Lei 12.965/2014), garantir disponibilidade das gravações pelo período contratado. A Plataforma pode ser atualizada sem aviso prévio, sem redução dos serviços essenciais.` },
  { id: 'obrigacoes-usuario', title: '6. Obrigações do Usuário', content: `Fornecer dados verídicos, manter sigilo das credenciais, utilizar a Plataforma somente para as finalidades previstas, não realizar engenharia reversa, não usar automações ou mineração de dados, não redistribuir gravações, comunicar imediatamente qualquer comprometimento de credenciais.` },
  { id: 'acesso', title: '7. Acesso', content: `Acesso via interface web ou API autorizada. Login = e-mail cadastrado. Senha mínima: 8 caracteres (maiúscula, minúscula, número, especial). O Integrador cria e revoga acessos. Magic Links para Clientes Finais têm prazo configurável pelo Integrador.` },
  { id: 'ia', title: '8. IA e Limitações', content: `Funcionalidades de IA (facial, LPR, busca semântica, EPI, analytics) não têm garantia de acurácia. Desempenho pode ser afetado por iluminação, ângulo e qualidade de imagem. Não devem ser usadas como único meio de decisão. A ICV pode usar imagens para treinar modelos internos, respeitando a LGPD.` },
  { id: 'responsabilidade', title: '9. Limitação de Responsabilidade', content: `A ICV não garante operação ininterrupta. Não se responsabiliza por: falhas de infraestrutura local, streaming não recebido por causas externas, perda de imagens em serviços de armazenamento de terceiros, danos indiretos ou lucros cessantes. Responsabilidade máxima limitada a 1 mensalidade.` },
  { id: 'pi', title: '10. Propriedade Intelectual', content: `A marca, logotipo, código-fonte, interfaces e algoritmos de IA são propriedade exclusiva da IA Cloud Vision LTDA, protegidos pelas Leis 9.279/96, 9.609/98 e 9.610/98. O Usuário recebe licença limitada, não exclusiva e intransferível, válida durante a vigência contratual.` },
  { id: 'rescisao', title: '11. Rescisão', content: `Contrato por prazo indeterminado. Cancelamento a qualquer momento pelos canais oficiais, sem reembolso de valores pagos. Violação dos Termos permite rescisão imediata. Após rescisão, dados e imagens são eliminados conforme prazos da Política de Privacidade.` },
  { id: 'geral', title: '12. Disposições Gerais', content: `Regidos pela legislação brasileira. Foro eleito: Comarca de São Paulo/SP. Atualizações comunicadas por e-mail. Uso continuado após notificação implica concordância. Contato: legal@iacloudvision.com.br` },
]

export function TermsPage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-space-900" style={{ fontFamily: "'Inter', sans-serif" }}>
      <nav className="sticky top-0 z-30 bg-white dark:bg-space-800/80 backdrop-blur border-b border-slate-200 dark:border-white/10 shadow-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/login" className="flex items-center gap-1.5 text-slate-500 hover:text-cyan-600 transition-colors text-sm">
              <ChevronLeft className="w-4 h-4"/> Voltar
            </Link>
            <span className="text-slate-300 dark:text-white/20">|</span>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-600"/>
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Termos de Uso</span>
            </div>
          </div>
          <span className="text-xs text-slate-400">Atualizado em {LAST_UPDATED}</span>
        </div>
      </nav>

      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-cyan-900 text-white py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-cyan-400"/>
              <span className="text-cyan-400 text-sm font-semibold uppercase tracking-widest">IA Cloud Vision LTDA</span>
            </div>
            <h1 className="text-4xl font-extrabold mb-3">Termos de Uso</h1>
            <p className="text-slate-300 max-w-2xl">Leia atentamente antes de utilizar a Plataforma. Ao acessar, você declara concordância integral com as disposições a seguir.</p>
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
                    <div key={li} className="flex gap-2">
                      <span className="text-cyan-500 dark:text-cyan-400 shrink-0 mt-0.5">•</span>
                      <span>{line.slice(2)}</span>
                    </div>
                  ) : <p key={li}>{line}</p>
                )}
              </div>
            </motion.section>
          ))}

          <div className="bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/30 rounded-2xl p-6 text-center">
            <Shield className="w-6 h-6 text-cyan-600 dark:text-cyan-400 mx-auto mb-2"/>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">IA Cloud Vision LTDA</p>
            <p className="text-xs text-slate-500">Dúvidas: <a href="mailto:legal@iacloudvision.com.br" className="text-cyan-600 dark:text-cyan-400 hover:underline">legal@iacloudvision.com.br</a></p>
            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-400">
              <Link to="/privacy" className="hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors">Política de Privacidade</Link>
              <span>·</span>
              <Link to="/login" className="hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors">Voltar ao Login</Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
