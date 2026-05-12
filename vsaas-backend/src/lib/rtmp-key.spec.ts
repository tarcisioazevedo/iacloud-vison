/**
 * rtmp-key unit tests — Sprint γ-Day1
 *
 * IDs U04-U05 do plano QA.
 *
 * Cobre:
 *   - generateRtmpStreamKey: formato + entropia
 *   - isWellFormedRtmpKey: classe positiva/negativa
 *   - buildRtmpPushUrl: port padrão omitido / custom
 *   - maskRtmpKey: não vaza segredo em logs
 */
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  generateRtmpStreamKey,
  isWellFormedRtmpKey,
  buildRtmpPushUrl,
  maskRtmpKey,
} from './rtmp-key'

describe('generateRtmpStreamKey', () => {
  it('gera com prefixo cam_ e tamanho mínimo URL-safe', () => {
    const k = generateRtmpStreamKey()
    expect(k.startsWith('cam_')).toBe(true)
    expect(k.length).toBeGreaterThanOrEqual(32)  // cam_ + 28+
    expect(k).toMatch(/^cam_[A-Za-z0-9_-]+$/)
  })

  it('1k chaves geradas são únicas (entropy check)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(generateRtmpStreamKey())
    expect(set.size).toBe(1000)
  })

  it('nunca contém caracteres que precisam escape em URL', () => {
    const k = generateRtmpStreamKey()
    expect(k).not.toMatch(/[+/=?#&]/)
  })
})

describe('isWellFormedRtmpKey', () => {
  it('aceita chaves geradas pela própria função', () => {
    for (let i = 0; i < 50; i++) {
      expect(isWellFormedRtmpKey(generateRtmpStreamKey())).toBe(true)
    }
  })

  it('aceita a chave real usada no smoke test de hoje', () => {
    expect(isWellFormedRtmpKey('cam_BCk0FNGgFUG7xqiEklfq0GgkRnODAeQP')).toBe(true)
  })

  it.each([
    ['', 'empty'],
    ['cam', 'só prefixo'],
    ['cam_short', 'curto demais (<20 random)'],
    ['CAM_uppercasekeysuffixhereXyz', 'prefixo maiúsculo'],
    ['key_aaaaaaaaaaaaaaaaaaaaa', 'prefixo errado'],
    ['cam_!@#$$$bad_chars_here_xx', 'caracteres inválidos'],
    ['cam_ ' + 'a'.repeat(30), 'contém espaço'],
  ])('rejeita inválido: %s (%s)', (key) => {
    expect(isWellFormedRtmpKey(key)).toBe(false)
  })
})

describe('buildRtmpPushUrl', () => {
  it('omite porta quando é a default 1935', () => {
    expect(buildRtmpPushUrl('app.iacloud.com.br', 1935, 'cam_xyz'))
      .toBe('rtmp://app.iacloud.com.br/live/cam_xyz')
  })

  it('inclui porta quando não-default', () => {
    expect(buildRtmpPushUrl('localhost', 11935, 'cam_xyz'))
      .toBe('rtmp://localhost:11935/live/cam_xyz')
  })

  it('mantém compatibilidade: sempre tem prefixo /live/<key>', () => {
    fc.assert(fc.property(
      fc.constant('app.iacloud.com.br'),
      fc.integer({ min: 1, max: 65535 }),
      fc.stringMatching(/^cam_[A-Za-z0-9_-]{20,80}$/),
      (host, port, key) => {
        const url = buildRtmpPushUrl(host, port, key)
        expect(url.startsWith('rtmp://')).toBe(true)
        expect(url).toContain('/live/' + key)
      },
    ), { numRuns: 50 })
  })
})

describe('maskRtmpKey', () => {
  it('mascara mantendo prefixo + últimos 4 chars', () => {
    expect(maskRtmpKey('cam_BCk0FNGgFUG7xqiEklfq0GgkRnODAeQP'))
      .toBe('cam_BCk…DAeQP'.replace('DAeQP', 'AeQP')) // 4 últimos
  })

  it('chaves muito curtas viram ****', () => {
    expect(maskRtmpKey('short')).toBe('****')
    expect(maskRtmpKey('')).toBe('****')
  })

  it('nunca vaza o segredo inteiro em qualquer entrada plausível', () => {
    fc.assert(fc.property(
      fc.stringMatching(/^cam_[A-Za-z0-9_-]{20,80}$/),
      (key) => {
        const masked = maskRtmpKey(key)
        // O segredo "do meio" não deve aparecer
        const middle = key.slice(7, -4)
        expect(masked).not.toContain(middle)
      },
    ), { numRuns: 100 })
  })
})
