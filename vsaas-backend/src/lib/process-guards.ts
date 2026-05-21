/**
 * Process-level guards para Node 20.
 *
 * Por quê: em Node 15+, uma `unhandledRejection` mata o processo. O backend
 * VSaaS tem ~80 handlers async em rotas; qualquer `throw` dentro de um handler
 * async sem try/catch vira rejection não tratada e derruba o container inteiro
 * — afetando TODOS os tenants. Esses guards mantêm o processo vivo e delegam
 * o erro para o errorHandler quando possível. `uncaughtException` ainda é
 * tratado como fatal se for um programming error real (sair após flush de log).
 */
import type { Server } from 'http'
import * as Sentry from '@sentry/node'
import { logger } from './logger'

let httpServer: Server | null = null

export function registerHttpServer(server: Server): void {
  httpServer = server
}

export function installProcessGuards(): void {
  // Promise rejeitada sem .catch → NÃO mata o processo em runtime.
  // O errorHandler global do Express trata isso via next(err) quando o
  // asyncHandler wrapper estiver presente. Aqui é o fallback defensivo.
  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    logger.error(
      { err, kind: 'unhandledRejection' },
      'Promise rejeitada sem handler — verifique se o handler async está envolvido com asyncHandler()',
    )
    Sentry.captureException(err)
  })

  process.on('uncaughtException', (err: Error) => {
    logger.fatal({ err, kind: 'uncaughtException' }, 'Uncaught exception — shutdown controlado')
    Sentry.captureException(err)
    gracefulShutdown('uncaughtException', 1)
  })

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM', 0))
  process.on('SIGINT', () => gracefulShutdown('SIGINT', 0))
}

let shuttingDown = false

export function gracefulShutdown(reason: string, exitCode: number): void {
  if (shuttingDown) return
  shuttingDown = true
  logger.info({ reason }, 'shutdown_started')

  // Força saída se shutdown demorar mais de 20s (evita processos zumbi).
  // Docker stop_grace_period = 30s — 20s garante saída limpa antes do SIGKILL.
  const forceExitTimer = setTimeout(() => {
    logger.warn('shutdown_forced_timeout')
    process.exit(exitCode)
  }, 20_000)
  forceExitTimer.unref()

  const done = (): void => {
    Sentry.flush(2000).finally(() => {
      logger.info({ reason }, 'shutdown_completed')
      clearTimeout(forceExitTimer)
      process.exit(exitCode)
    })
  }

  if (!httpServer) {
    done()
    return
  }

  // Para de aceitar novos sockets, drena requests em voo.
  // closeAllConnections() encerra SSE e keep-alive imediatamente —
  // sem isso httpServer.close() fica pendurado indefinidamente em
  // conexões longas (SSE, timelapse streaming) e leva ao SIGKILL (exit 137).
  httpServer.close((err) => {
    if (err) logger.error({ err }, 'http_server_close_error')
    done()
  })
  // Node 18.2+: força fechamento de conexões abertas (SSE, keep-alive).
  // Chamado logo após close() para não perder o callback acima.
  httpServer.closeAllConnections()
}
