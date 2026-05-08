/**
 * Camera → Integrador (tenant) lookup cache.
 *
 * Hot path: GET /playback/:id/segments/:sid.ts é chamado ~5000×/dia/câmera.
 * Cada hit fazia JOIN aninhado camera → site → clienteFinal → integradorId
 * só pra resolver bucket R2.
 *
 * Cache local em memória (TTL 5 min) elimina 95% das queries:
 *   - Mapeamento camera→integrador muda raríssimo (só em "mover câmera").
 *   - 5 min de stale é aceitável: pior caso = 1 segment vai pro bucket
 *     antigo após mover. Não corrompe nada (segment é write-once via worker).
 *
 * Para invalidar manualmente em caso de move/transfer, exportamos `invalidate`.
 */
import { prisma } from './prisma'

const TTL_MS = 5 * 60_000
const cache = new Map<string, { v: string; ts: number }>()

/**
 * Retorna integradorId da câmera (com cache de 5 min). Fallback: 'default'.
 */
export async function getIntegradorIdForCamera(cameraId: string): Promise<string> {
  const c = cache.get(cameraId)
  if (c && Date.now() - c.ts < TTL_MS) return c.v

  const cam = await prisma.camera.findUnique({
    where: { id: cameraId },
    select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } },
  })
  const v = cam?.site?.clienteFinal?.integradorId ?? 'default'
  cache.set(cameraId, { v, ts: Date.now() })
  return v
}

/**
 * Invalida entrada (chamar em endpoints de move/transfer).
 * Sem cameraId: limpa cache inteiro (uso raro, só em testes ou troca de tenant).
 */
export function invalidate(cameraId?: string): void {
  if (cameraId) cache.delete(cameraId)
  else cache.clear()
}
