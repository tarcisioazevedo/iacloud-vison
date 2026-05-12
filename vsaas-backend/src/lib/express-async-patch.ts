/**
 * Patch do Express 4 para suporte nativo a handlers async.
 *
 * Por padrão, Express 4 só captura `throw` síncrono. Uma Promise rejeitada
 * retornada por um handler async vira `unhandledRejection` — que em Node 20
 * mata o processo inteiro. Express 5 (ainda em beta) resolve nativamente.
 *
 * Este patch intercepta o `Layer.prototype.handle_request` do Express,
 * verifica se o retorno é uma Promise e, se for, chama `next(err)` quando
 * ela rejeita. Com isso, todo handler async no app passa a se comportar
 * como handler síncrono do ponto de vista do errorHandler.
 *
 * Mesma técnica usada por `express-async-errors` (~1M downloads/semana).
 * Fazemos in-house para evitar dependência e deixar o comportamento
 * auditável no próprio repo.
 *
 * IMPORTANTE: importar ESTE ARQUIVO ANTES de qualquer rota — uma vez só,
 * bem no topo de app.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer')

type ExpressHandler = (...args: unknown[]) => unknown

interface LayerProto {
  handle_request: ExpressHandler
  handle_error: ExpressHandler
  handle: ExpressHandler & { length: number }
}

// Evita patch duplo se o módulo for carregado mais de uma vez (vite/tsx HMR).
if (!(Layer as { __async_patched__?: boolean }).__async_patched__) {
  const proto = Layer.prototype as LayerProto

  const origHandleRequest = proto.handle_request
  proto.handle_request = function patchedHandleRequest(
    this: LayerProto,
    ...args: unknown[]
  ) {
    const [, , next] = args as [unknown, unknown, (err?: unknown) => void]
    const fn = this.handle

    // Handlers de erro têm aridade 4 (err, req, res, next) — não mexer.
    if (fn.length === 4) {
      return origHandleRequest.apply(this, args)
    }

    try {
      const result = fn.apply(this, args)
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch(next)
      }
    } catch (err) {
      next(err)
    }
  }

  ;(Layer as { __async_patched__?: boolean }).__async_patched__ = true
}

export {}
