/**
 * AI Agent Service — chat sobre o CFTV via Gemini Pro com function calling.
 *
 * Operador pergunta em PT-BR:
 *   "Houve algo estranho na garagem ontem?"
 *
 * Gemini chama uma das tools expostas:
 *   • search_events(camera, time_from, time_to, object_type)
 *   • get_review_segments(camera, time_from, time_to, severity_min)
 *   • summarize_period(camera, time_from, time_to)
 *   • describe_event(event_id)
 *   • compare_events(event_id_a, event_id_b)
 *
 * Backend executa, devolve resultado pra Gemini, que sintetiza a resposta.
 *
 * Cap de billing in-memory no genai.service.
 */

import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import {
  chatWithTools,
  genaiAvailable,
  type ChatMessage,
  type FunctionToolDef,
} from './genai.service'

// =============================================================================
// Tool definitions
// =============================================================================

const TOOLS: FunctionToolDef[] = [
  {
    name: 'search_events',
    description:
      'Busca DetectionEvents (objetos detectados pela IA) numa janela de tempo. ' +
      'Use quando o operador perguntar sobre objetos vistos, movimentações, contagens.',
    parameters: {
      type: 'object',
      properties: {
        camera_id: { type: 'string', description: 'UUID da câmera. Opcional — sem isso busca em todas do tenant.' },
        time_from: { type: 'string', description: 'ISO datetime início (ex: 2026-05-14T00:00:00Z).' },
        time_to:   { type: 'string', description: 'ISO datetime fim.' },
        object_type: { type: 'string', description: 'Tipo COCO (person, car, truck, etc). Opcional.' },
        limit:     { type: 'number', description: 'Máximo de resultados (default 30, max 100).' },
      },
      required: ['time_from', 'time_to'],
    },
  },
  {
    name: 'get_review_segments',
    description:
      'Lista ReviewSegments (agrupamentos de events por janela e severity). ' +
      'Use quando o operador quer ver "o que aconteceu" de forma resumida.',
    parameters: {
      type: 'object',
      properties: {
        camera_id: { type: 'string' },
        time_from: { type: 'string' },
        time_to:   { type: 'string' },
        severity:  { type: 'string', enum: ['ALERT', 'DETECTION', 'SIGNIFICANT'] },
        limit:     { type: 'number' },
      },
      required: ['time_from', 'time_to'],
    },
  },
  {
    name: 'describe_event',
    description: 'Retorna a descrição GenAI (PT-BR) e atributos extraídos de um event específico.',
    parameters: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
      },
      required: ['event_id'],
    },
  },
  {
    name: 'compare_events',
    description: 'Compara dois events visualmente. Retorna se é mesma pessoa/veículo. Custa R$0,02/chamada.',
    parameters: {
      type: 'object',
      properties: {
        event_id_a: { type: 'string' },
        event_id_b: { type: 'string' },
      },
      required: ['event_id_a', 'event_id_b'],
    },
  },
  {
    name: 'build_playback_link',
    description:
      'Gera link clicável de playback (timeline) para uma câmera em um momento específico. ' +
      'Use quando o usuário pedir "ver na timeline", "abrir gravação", "link para reproduzir", "ver no playback". ' +
      'Retorna URL absoluto pra https://app.vsaas.com.br/recordings com cameraId e at no formato ISO. ' +
      'Também checa se há gravação cobrindo o instante (coverage) e avisa se for gap.',
    parameters: {
      type: 'object',
      properties: {
        camera_id: { type: 'string', description: 'UUID da câmera.' },
        at:        { type: 'string', description: 'Momento do evento em ISO 8601 (ex: 2026-05-21T18:09:39Z).' },
      },
      required: ['camera_id', 'at'],
    },
  },
  {
    name: 'list_cameras',
    description:
      'Lista câmeras acessíveis pelo usuário com id, nome, site, status. ' +
      'Use quando o operador perguntar "quais câmeras tenho?" ou precisar de um cameraId pra outra tool.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Opcional — filtra por site.' },
      },
      required: [],
    },
  },
]

function buildSystemInstruction(): string {
  const now = new Date()
  const dateBR = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const isoNow = now.toISOString()
  const today  = isoNow.slice(0, 10)
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  return `Você é um assistente de operação CFTV (Closed-Circuit Television).
O usuário monitora câmeras de segurança e busca informações sobre o que foi detectado pela IA.

CONTEXTO TEMPORAL (USE ESTES VALORES, nunca invente datas):
  • Agora: ${isoNow} (UTC) / ${dateBR} (horário de Brasília)
  • Hoje: ${today}
  • Ontem: ${yesterday}

Quando o usuário fizer uma pergunta:
1. Use as ferramentas disponíveis pra buscar dados reais (não invente).
2. Se a janela de tempo não estiver clara, ASSUMA "últimas 24 horas" desde agora.
3. Para "hoje", use time_from=${today}T00:00:00Z e time_to=${isoNow}.
4. Para "ontem", use time_from=${yesterday}T00:00:00Z e time_to=${yesterday}T23:59:59Z.
5. Resuma resultados em PT-BR. Timestamps no formato HH:MM (horário de Brasília).
6. Sempre cite quantidades exatas. Se for 0, diga claramente "Nenhum evento encontrado nesse período".
7. NÃO especule emoções ou intenções dos objetos detectados. Seja factual.
8. Quando o usuário pedir "link para timeline", "link da gravação", "ver no playback", "abrir gravação":
   - Use a ferramenta build_playback_link com camera_id + at (do evento).
   - SEMPRE renderize a URL retornada como link markdown clicável: [▶ Abrir no playback](URL).
   - Se a tool retornar coverage='em_gap', AVISE o usuário no texto: "⚠️ Evento durante gap de gravação — playback vai mostrar o segmento mais próximo".
9. Se precisar de cameraId e não tiver, chame list_cameras primeiro.

Você tem acesso APENAS ao tenant do usuário logado — escopo aplicado server-side.`
}

// =============================================================================
// Tool execution (server-side, com escopo do tenant do user logado)
// =============================================================================

interface TenantScope {
  integradorId?: string | null
  clienteFinalId?: string | null
  siteId?: string | null
}

async function execSearchEvents(args: any, scope: TenantScope) {
  const limit = Math.min(args.limit ?? 30, 100)
  const events = await prisma.detectionEvent.findMany({
    where: {
      ...(args.camera_id ? { cameraId: args.camera_id } : {}),
      ...(args.object_type ? { objectType: args.object_type } : {}),
      startTime: {
        gte: new Date(args.time_from),
        lte: new Date(args.time_to),
      },
      falsePositive: false,
      camera: scope.integradorId
        ? { site: { clienteFinal: { integradorId: scope.integradorId } } }
        : scope.clienteFinalId
          ? { site: { clienteFinalId: scope.clienteFinalId } }
          : {},
    },
    orderBy: { startTime: 'desc' },
    take: limit,
    select: {
      id: true, objectType: true, startTime: true, endTime: true,
      durationSec: true, topScore: true, description: true,
      camera: { select: { id: true, name: true } },
    },
  })

  return {
    count: events.length,
    events: events.map(e => ({
      id: e.id,
      camera: e.camera.name,
      object: e.objectType,
      start: e.startTime.toISOString(),
      duration_sec: e.durationSec,
      confidence: Math.round(e.topScore * 100),
      description: e.description || null,
    })),
  }
}

async function execGetReviewSegments(args: any, scope: TenantScope) {
  const limit = Math.min(args.limit ?? 20, 50)
  const segments = await prisma.reviewSegment.findMany({
    where: {
      ...(args.camera_id ? { cameraId: args.camera_id } : {}),
      ...(args.severity ? { severity: args.severity } : {}),
      startTime: {
        gte: new Date(args.time_from),
        lte: new Date(args.time_to),
      },
      camera: scope.integradorId
        ? { site: { clienteFinal: { integradorId: scope.integradorId } } }
        : scope.clienteFinalId
          ? { site: { clienteFinalId: scope.clienteFinalId } }
          : {},
    },
    orderBy: { startTime: 'desc' },
    take: limit,
    select: {
      id: true, severity: true, startTime: true, endTime: true,
      labels: true, zones: true,
      camera: { select: { name: true } },
      events: {
        select: { objectType: true, topScore: true },
      },
    },
  })

  return {
    count: segments.length,
    segments: segments.map(s => ({
      id: s.id,
      camera: s.camera.name,
      severity: s.severity,
      start: s.startTime.toISOString(),
      end: s.endTime?.toISOString() ?? null,
      labels_seen: s.labels,
      zones_crossed: s.zones,
      events_count: s.events.length,
    })),
  }
}

async function execDescribeEvent(args: any, scope: TenantScope) {
  const evt = await prisma.detectionEvent.findFirst({
    where: {
      id: args.event_id,
      camera: scope.integradorId
        ? { site: { clienteFinal: { integradorId: scope.integradorId } } }
        : scope.clienteFinalId
          ? { site: { clienteFinalId: scope.clienteFinalId } }
          : {},
    },
    select: {
      objectType: true, startTime: true, endTime: true,
      topScore: true, description: true, descriptionAttributes: true,
      camera: { select: { name: true } },
    },
  })
  if (!evt) return { error: 'event not found or access denied' }
  return {
    camera: evt.camera.name,
    object: evt.objectType,
    start: evt.startTime.toISOString(),
    duration_sec: evt.endTime ? (+evt.endTime - +evt.startTime) / 1000 : null,
    confidence: Math.round(evt.topScore * 100),
    description: evt.description,
    attributes: evt.descriptionAttributes,
  }
}

async function execCompareEvents(_args: any, _scope: TenantScope) {
  // Mock — versão completa exige thumbnails persistidos em R2.
  // Por enquanto retorna "not implemented" pra não quebrar o flow.
  return {
    same_subject: 'unknown',
    confidence: 0,
    reason: 'Comparação visual requer thumbnails persistidos (job snapshot R2 — em breve)',
  }
}

async function execBuildPlaybackLink(args: any, scope: TenantScope) {
  // Valida câmera no escopo do user
  const cam = await prisma.camera.findFirst({
    where: {
      id: args.camera_id,
      site: scope.integradorId
        ? { clienteFinal: { integradorId: scope.integradorId } }
        : scope.clienteFinalId
          ? { clienteFinalId: scope.clienteFinalId }
          : {},
    },
    select: { id: true, name: true },
  })
  if (!cam) return { error: 'camera_not_found_or_no_access' }

  const at = new Date(args.at)
  if (isNaN(at.getTime())) return { error: 'at_invalido' }

  // Checa cobertura (se há gravação no exato momento)
  const exact = await prisma.recordingSegment.findFirst({
    where: { cameraId: args.camera_id, startedAt: { lte: at }, endedAt: { gt: at } },
    select: { startedAt: true, endedAt: true },
  })
  const before = !exact ? await prisma.recordingSegment.findFirst({
    where: { cameraId: args.camera_id, endedAt: { lte: at } },
    orderBy: { endedAt: 'desc' },
    select: { endedAt: true },
  }) : null
  const after = !exact ? await prisma.recordingSegment.findFirst({
    where: { cameraId: args.camera_id, startedAt: { gt: at } },
    orderBy: { startedAt: 'asc' },
    select: { startedAt: true },
  }) : null

  const playbackUrl = `https://app.vsaas.com.br/recordings?cameraId=${cam.id}&at=${encodeURIComponent(at.toISOString())}`
  const atBrt = at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  return {
    url: playbackUrl,
    camera_name: cam.name,
    at_iso: at.toISOString(),
    at_brt: atBrt,
    coverage: exact ? 'tem_gravacao' : 'em_gap',
    gap_info: !exact ? {
      ultimo_antes_brt: before?.endedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) ?? null,
      primeiro_depois_brt: after?.startedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) ?? null,
    } : null,
  }
}

async function execListCameras(args: any, scope: TenantScope) {
  const cameras = await prisma.camera.findMany({
    where: {
      ...(args.site_id ? { siteId: args.site_id } : {}),
      site: scope.integradorId
        ? { clienteFinal: { integradorId: scope.integradorId } }
        : scope.clienteFinalId
          ? { clienteFinalId: scope.clienteFinalId }
          : {},
    },
    select: {
      id: true, name: true, active: true,
      site: { select: { id: true, name: true, clienteFinal: { select: { name: true } } } },
    },
    orderBy: { name: 'asc' },
    take: 50,
  })
  return {
    count: cameras.length,
    cameras: cameras.map(c => ({
      id: c.id,
      name: c.name,
      active: c.active,
      site: c.site?.name ?? null,
      cliente: c.site?.clienteFinal?.name ?? null,
    })),
  }
}

const TOOL_HANDLERS: Record<string, (args: any, scope: TenantScope) => Promise<any>> = {
  search_events: execSearchEvents,
  get_review_segments: execGetReviewSegments,
  describe_event: execDescribeEvent,
  compare_events: execCompareEvents,
  build_playback_link: execBuildPlaybackLink,
  list_cameras: execListCameras,
}

// =============================================================================
// chatTurn — orquestra um turn (user prompt → tool calls → final answer)
// =============================================================================

export interface AgentTurnResult {
  text: string | null
  toolsCalled: string[]
  finishReason: string
}

export async function chatTurn(
  history: ChatMessage[],
  userMessage: string,
  scope: TenantScope,
): Promise<AgentTurnResult> {
  if (!genaiAvailable()) {
    return {
      text: 'O assistente IA não está configurado. Peça ao admin pra habilitar o Gemini (GEMINI_API_KEY).',
      toolsCalled: [],
      finishReason: 'NO_GENAI',
    }
  }

  // Anexa mensagem do usuário no history
  const conv: ChatMessage[] = [
    ...history,
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  const toolsCalled: string[] = []
  const MAX_TOOL_ITERATIONS = 4

  const systemInstruction = buildSystemInstruction()

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const result = await chatWithTools(conv, TOOLS, systemInstruction)
    if (!result) {
      return { text: 'Erro ao consultar o assistente. Tente novamente.', toolsCalled, finishReason: 'ERROR' }
    }

    // Se tem tool calls, executa todas e adiciona function responses ao history
    if (result.toolCalls.length > 0) {
      const responseParts: any[] = []
      for (const tc of result.toolCalls) {
        toolsCalled.push(tc.name)
        const handler = TOOL_HANDLERS[tc.name]
        if (!handler) {
          responseParts.push({
            functionResponse: { name: tc.name, response: { error: 'unknown tool' } },
          })
          continue
        }
        try {
          const out = await handler(tc.args, scope)
          responseParts.push({
            functionResponse: { name: tc.name, response: out },
          })
        } catch (e: any) {
          logger.warn({ tool: tc.name, err: e.message }, 'ai_agent_tool_error')
          responseParts.push({
            functionResponse: { name: tc.name, response: { error: e.message } },
          })
        }
      }
      // Adiciona model response + function responses pro próximo turn
      conv.push({ role: 'model', parts: result.toolCalls.map(tc => ({ functionCall: tc as any })) })
      conv.push({ role: 'user', parts: responseParts })
      continue  // próxima iteração
    }

    // Sem tool calls → resposta final
    // Se texto vazio após tool calls, força um turn de síntese pra Gemini
    // gerar uma resposta humana sobre os resultados.
    if ((!result.text || result.text.trim() === '') && toolsCalled.length > 0 && iter < MAX_TOOL_ITERATIONS - 1) {
      logger.info({ iter, toolsCalled }, 'ai_agent_empty_text_forcing_summary')
      conv.push({
        role: 'user',
        parts: [{ text: 'Com base nos dados acima, escreva uma resposta natural em PT-BR pro usuário. Se não há resultados, diga claramente "Nenhum evento encontrado nesse período" e sugira alternativa.' }],
      })
      continue
    }

    return {
      text: result.text || 'Não consegui formular uma resposta. Tente reformular a pergunta.',
      toolsCalled,
      finishReason: result.finishReason,
    }
  }

  return {
    text: 'Limite de iterações com ferramentas atingido — refrasear a pergunta.',
    toolsCalled,
    finishReason: 'MAX_ITER',
  }
}
