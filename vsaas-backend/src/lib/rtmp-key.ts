/**
 * Helpers para stream keys do modo de ingestão RTMP push.
 *
 * Stream key é o segredo que a câmera usa para se autenticar quando
 * empurra RTMP pro nosso endpoint público:
 *
 *     rtmp://ingest.iacloud.com.br/live/<STREAM_KEY>
 *
 * Quem tem a key consegue empurrar stream em nome da câmera. Por isso
 * cifra (AES-256-GCM) antes de persistir e nunca volta no GET por padrão
 * — só via endpoint específico de "revelar" (com log de auditoria).
 *
 * Segurança das keys:
 *   - 24 bytes aleatórios (192 bits) → 32 chars base64url (sem padding)
 *   - Inclui prefixo `cam_` para distinguir visualmente em logs
 *     e impedir colisão acidental com outros tipos de token
 *   - Apenas alfanumérico+`-_` (URL-safe), sem caracteres que precisam
 *     escape em URL/RTMP path
 *
 * Rotação: gerar nova key invalida a anterior — o operador é quem
 * atualiza a config da câmera com a nova URL. Útil quando suspeita
 * de vazamento.
 */
import { randomBytes } from 'crypto'

const KEY_PREFIX = 'cam_'
const KEY_RANDOM_BYTES = 24

/**
 * Gera uma nova stream key segura. Formato `cam_<32chars-base64url>`.
 *
 * Tamanho total: 36 chars. Espaço de busca = 2^192 — inviável bruteforce
 * em qualquer cenário realista (mais que UUID v4).
 */
export function generateRtmpStreamKey(): string {
  const random = randomBytes(KEY_RANDOM_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `${KEY_PREFIX}${random}`
}

/**
 * Validação leve do formato — usado pra rejeitar paths obviamente
 * inválidos antes mesmo de tocar no banco. Não substitui validação
 * de existência (lookup via decryptSecret + comparação).
 */
export function isWellFormedRtmpKey(key: string): boolean {
  return /^cam_[A-Za-z0-9_-]{20,80}$/.test(key)
}

/**
 * Monta a URL completa que o operador cola na câmera. O host vem de
 * env (`RTMP_INGEST_PUBLIC_HOST`) — em dev usamos IP do host; em prod
 * `ingest.iacloud.com.br`. Porta default 1935 pode ser omitida quando
 * for a padrão (a maioria das câmeras aceita sem :1935 explícito).
 *
 * Path: `/live/<key>` — convenção do nosso ingestor. A câmera Hikvision
 * com firmware simplificado usa esse path automaticamente.
 */
export function buildRtmpPushUrl(host: string, port: number, key: string): string {
  const portSuffix = port === 1935 ? '' : `:${port}`
  return `rtmp://${host}${portSuffix}/live/${key}`
}

/**
 * Mascara a key pra exibição em logs/UI quando NÃO queremos revelar
 * o segredo inteiro. Mostra prefixo + últimos 4 chars: `cam_abc123…wxyz`.
 */
export function maskRtmpKey(key: string): string {
  if (key.length <= 12) return '****'
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}
