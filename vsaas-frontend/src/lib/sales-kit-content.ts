/**
 * Sales Kit content — dados estáticos dos materiais de venda.
 *
 * White-label: no render, o integrador injeta logo/cor/nome via prop.
 * Cases: fictícios mas realistas — substituir por casos reais quando disponível.
 */

export interface VerticalCase {
  client: string
  context: string
  result: string
  metric: string
}

export interface Vertical {
  slug: 'varejo' | 'condominio' | 'industria' | 'smart-city' | 'saude' | 'educacao'
  emoji: string
  title: string
  subtitle: string
  painPoints: string[]
  solutions: string[]
  cases: VerticalCase[]
  roiHint: string  // texto curto pro card
}

export const VERTICALS: Vertical[] = [
  {
    slug: 'varejo',
    emoji: '🛍️',
    title: 'Varejo',
    subtitle: 'Shopping, lojas de rua, redes',
    painPoints: [
      'Quebra (shrinkage) entre 1,8% e 2,5% do faturamento',
      'Fluxo de visitantes não medido por porta/horário',
      'Filas longas perdendo conversão no caixa',
      'Roubos por funcionário não detectados',
    ],
    solutions: [
      'IA de Detecção de Anomalia + LPR no estacionamento',
      'Heatmap de fluxo + Contagem por zona',
      'Detecção de aglomeração em filas',
      'Auditoria de comportamento atípico (POS)',
    ],
    cases: [
      {
        client: 'Rede de farmácias regional (28 lojas, SP)',
        context: 'Shrinkage de 2,1% impactando margem em R$ 1,4M/ano',
        result: 'Detecção automática de comportamentos suspeitos + auditoria por câmera no caixa',
        metric: '−32% em shrinkage em 90 dias · ROI de 4 meses',
      },
      {
        client: 'Shopping de médio porte (RJ)',
        context: 'Sem dados de conversão por loja',
        result: 'Heatmap por loja + contagem de entrada cruzando com vendas do PDV',
        metric: '+18% conversão em lojas com baixo fluxo após reorganização',
      },
    ],
    roiHint: 'Tipicamente 3-5 meses de payback em redes com 20+ lojas.',
  },
  {
    slug: 'condominio',
    emoji: '🏢',
    title: 'Condomínio',
    subtitle: 'Residencial, comercial, mistos',
    painPoints: [
      'Controle manual de visitantes/prestadores',
      'Roubos no estacionamento sem registro de placa',
      'Câmeras antigas sem inteligência — gravam, mas não avisam',
      'Síndico paga monitoramento humano caro',
    ],
    solutions: [
      'LPR no portão (allow-list de moradores + visitantes pré-cadastrados)',
      'Reconhecimento facial cadastrado por unidade',
      'Detecção de intrusão noturna com alerta direto pro síndico/portaria',
      'Histórico semantic search ("carro vermelho saindo às 3am")',
    ],
    cases: [
      {
        client: 'Condomínio de 240 unidades (Belo Horizonte)',
        context: 'Síndico pagando R$ 18k/mês por monitoramento humano',
        result: 'IA + 1 porteiro físico (vs 4) + LPR com aprovação por app',
        metric: '−65% custo de portaria · zero invasões em 12 meses',
      },
    ],
    roiHint: 'Substituição parcial de portaria humana paga em 6-9 meses.',
  },
  {
    slug: 'industria',
    emoji: '🏭',
    title: 'Indústria',
    subtitle: 'Plantas, distribuição, logística',
    painPoints: [
      'Acidentes por falta de EPI (capacete, colete, bota)',
      'Multas trabalhistas por NR-6 e NR-12',
      'Roubo de carga em pátios e docas',
      'Acessos não autorizados em áreas restritas',
    ],
    solutions: [
      'PPE Detection (capacete + colete + óculos + máscara) em tempo real',
      'Geofencing por zona com alerta cruzado com cartão de acesso',
      'LPR em portões + cross-check com lista de motoristas autorizados',
      'Detecção de queda + permanência prolongada (homem morto)',
    ],
    cases: [
      {
        client: 'Indústria química (interior de SP)',
        context: 'Multa de R$ 280k por NR-6 + 2 acidentes em 18 meses',
        result: 'PPE Detection com bloqueio de acesso à área restrita sem EPI',
        metric: 'Zero não-conformidades em fiscalizações · economia de R$ 280k/ano em multas',
      },
    ],
    roiHint: 'Multas NR evitadas + redução de seguro pagam em 4-8 meses.',
  },
  {
    slug: 'smart-city',
    emoji: '🏛️',
    title: 'Smart City',
    subtitle: 'Prefeitura, segurança pública, mobilidade',
    painPoints: [
      'Rede de câmeras ociosa — só gravação, sem inteligência',
      'Crimes de oportunidade não detectados em tempo real',
      'Tráfego sem dados pra otimização de semáforos',
      'Carros suspeitos não identificados antes do incidente',
    ],
    solutions: [
      'LPR em todas as principais entradas/saídas da cidade',
      'Cross-check com Sinesp/Detran (carros furtados)',
      'Detecção de aglomeração + perimetragem em áreas de risco',
      'Painel de comando integrado (CICC)',
    ],
    cases: [
      {
        client: 'Município de 350 mil habitantes (PR)',
        context: '90 câmeras instaladas, zero inteligência ativa',
        result: 'LPR em 12 pontos críticos + integração com Sinesp + dashboard pra Guarda Municipal',
        metric: '+47% recuperação de veículos furtados em 6 meses · alerta médio em 8s',
      },
    ],
    roiHint: 'Aproveitamento de infra existente + métricas pra orçamento federal.',
  },
  {
    slug: 'saude',
    emoji: '🏥',
    title: 'Saúde',
    subtitle: 'Hospitais, clínicas, postos',
    painPoints: [
      'Acessos a áreas restritas sem rastreio (sala de medicação)',
      'Furto de equipamentos médicos',
      'Quedas de pacientes idosos sem socorro imediato',
      'Recepção sobrecarregada em picos',
    ],
    solutions: [
      'Reconhecimento facial integrado com prontuário (acesso por área)',
      'Detecção de queda em corredores e enfermarias',
      'Heatmap de espera por setor',
      'LPR + cross-check com agenda do dia',
    ],
    cases: [
      {
        client: 'Hospital privado (210 leitos, GO)',
        context: '3 quedas com lesão grave em 2024 sem socorro em < 2min',
        result: 'Detecção de queda + alerta direto na enfermaria',
        metric: '100% das quedas detectadas em < 30s · redução de 70% em complicações',
      },
    ],
    roiHint: 'Risco médico-legal evitado + LGPD em dia.',
  },
  {
    slug: 'educacao',
    emoji: '🎓',
    title: 'Educação',
    subtitle: 'Escolas, universidades, creches',
    painPoints: [
      'Pais ansiosos pela segurança dos filhos',
      'Bullying e brigas não vistos pela equipe',
      'Estranhos no pátio sem detecção',
      'Saída de aluno sem responsável autorizado',
    ],
    solutions: [
      'Reconhecimento facial pais/responsáveis no portão (allow-list)',
      'Detecção de aglomeração atípica (briga em pátio)',
      'Alerta de pessoa não cadastrada em zona escolar',
      'Histórico de entrada/saída por aluno (compliance LGPD)',
    ],
    cases: [
      {
        client: 'Rede de escolas particulares (12 unidades, RS)',
        context: 'Demanda dos pais por mais segurança pós-incidente em rede vizinha',
        result: 'Face de responsáveis cadastrados + alerta de não-cadastrado + log por aluno',
        metric: '+24% retenção de matrículas (pesquisa de satisfação)',
      },
    ],
    roiHint: 'Diferencial de venda + redução de incidentes + compliance LGPD.',
  },
]

export const PLATFORM_HIGHLIGHTS = [
  { icon: 'Zap', label: 'Latência <1s ao vivo', desc: 'WHEP/MediaMTX vs HLS dos concorrentes' },
  { icon: 'Cpu', label: 'Edge ou Cloud', desc: 'Resiliência offline com gravação local' },
  { icon: 'Shield', label: 'LGPD compliant', desc: 'DSAR self-serve, audit log completo' },
  { icon: 'Sparkles', label: '32+ IAs nativas', desc: 'LPR, Face, EPI, Demographics, Anomalia' },
  { icon: 'Globe', label: 'Multi-tenant', desc: 'Hierarquia 5 níveis com white-label' },
  { icon: 'Activity', label: 'Health Score', desc: 'Saúde proativa do parque de câmeras' },
]

export const COMPETITIVE_DELTA = [
  { feature: 'Latência ao vivo',     ours: '<1s (WHEP)',     theirs: '6-20s (HLS)' },
  { feature: 'Retenção inclusa',     ours: '7 dias',         theirs: '3 dias' },
  { feature: 'Edge box on-prem',     ours: 'Sim — 3 cenários', theirs: 'Não' },
  { feature: 'Busca semântica IA',   ours: 'Vertex AI',      theirs: 'Não' },
  { feature: 'API pública',          ours: 'REST + Webhooks', theirs: 'Limitado' },
  { feature: 'White-label',          ours: '4 tiers + cascade', theirs: 'Não ou pago' },
]

export const EMAIL_TEMPLATES = [
  {
    id: 'first-contact',
    title: 'Primeiro contato (após indicação)',
    subject: 'Conversamos sobre VMS inteligente?',
    body: `Olá [NOME],

[INDICACAO_NOME] me passou seu contato comentando sobre seu interesse em modernizar o sistema de câmeras do/a [EMPRESA].

Trabalhamos com [INTEGRADOR_NOME] uma plataforma de VMS Cloud com IA nativa que reduz custos de monitoramento em 30-65% e detecta eventos automaticamente — sem precisar trocar suas câmeras existentes.

Posso reservar 15 minutos esta semana pra te mostrar 3 casos de empresas similares?

Ficamos no aguardo.

[ASSINATURA]`,
  },
  {
    id: 'after-demo',
    title: 'Pós-demonstração',
    subject: 'Resumo da demo + próximos passos',
    body: `Olá [NOME],

Foi ótimo te apresentar a plataforma hoje. Conforme conversamos, resumindo:

✓ [PROBLEMA_PRINCIPAL] que você apontou
✓ Demonstrei como [SOLUCAO_ESPECIFICA] resolve isso
✓ ROI estimado: payback em [X] meses

Próximos passos:
1. Vou enviar a proposta comercial até [DATA]
2. Trial gratuito de 14 dias com 5 câmeras (zero compromisso)
3. POC validada em até 30 dias

Qualquer dúvida, estou aqui.

[ASSINATURA]`,
  },
  {
    id: 'follow-up',
    title: 'Follow-up sem resposta (D+5)',
    subject: 'Acompanhamento — seu projeto VMS',
    body: `Olá [NOME],

Voltando pra confirmar se conseguiu revisar a proposta que enviei semana passada.

Caso tenha alguma dúvida específica ou queira ajustar o escopo (mais ou menos câmeras, IAs específicas, prazo de implantação), estou totalmente disponível.

Se preferir, podemos marcar 10 minutos esta semana pra alinhar.

[ASSINATURA]`,
  },
]
