import type { Request, Response, NextFunction, RequestHandler } from 'express'

/**
 * Wrapper para handlers async do Express.
 *
 * Problema: Express 4 só captura `throw` síncrono. Um `throw` dentro de um
 * handler async vira `unhandledRejection` → em Node 15+ isso mata o processo.
 * Resultado: uma única senha errada derruba o backend inteiro para TODOS os
 * tenants (ver crash em auth.ts:123 que apareceu no docker logs).
 *
 * Solução padrão Express: envolver a Promise com .catch(next). O `errorHandler`
 * global então vira o único lugar que formata erros para o cliente.
 *
 * Uso:
 *   router.post('/x', asyncHandler(async (req, res) => {
 *     if (!ok) throw new UnauthorizedError()   // vai pro errorHandler
 *     res.json(result)
 *   }))
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res as Res, next)).catch(next)
  }
}
