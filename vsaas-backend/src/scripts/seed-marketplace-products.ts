/**
 * Seed de produtos iniciais do marketplace.
 * Execução: npx tsx src/scripts/seed-marketplace-products.ts
 * Ou via docker exec (ver comentário abaixo).
 *
 * IMPORTANTE: secrets-bootstrap precisa rodar ANTES de importar prisma,
 * porque ele monta DATABASE_URL a partir de DB_PASSWORD_FILE + template.
 *
 * Idempotente via upsert por slug.
 *
 * MATRIZ OFICIAL (2026-05-23):
 *   4 qualidades (SD, HD, Full HD, 4K) × 7 durações (1, 3, 7, 15, 30, 90, 180 dias)
 *   = 28 planos STORAGE
 *
 * Pricing derivado da grade HD existente (anchor = 7 dias):
 *   - base por qualidade (USD/cam/mês @ 7d): SD 4.90 · HD 7.50 · FHD 11.50 · 4K 20.00
 *   - multiplicador por duração:
 *       1d=0.35 · 3d=0.55 · 7d=1.0 · 15d=1.47 · 30d=2.12 · 90d=4.27 · 180d=7.50
 *   - markup INT default 1.30 aplicado depois na exibição ao cliente final.
 *
 * Planos legados fora dessa matriz (ex: HD 60d) são desativados explicitamente
 * no main() pra manter histórico de subscriptions já contratadas.
 */
import '../lib/secrets-bootstrap'   // monta DATABASE_URL ANTES do prisma
import { prisma } from '../lib/prisma'

// ── Matriz de pricing ────────────────────────────────────────────────────────
const QUALITY_BASE_USD: Record<string, { label: string; resolution: string; basePriceUsd: number }> = {
  SD:  { label: 'SD',      resolution: 'SD',  basePriceUsd: 4.90 },
  HD:  { label: 'HD',      resolution: 'HD',  basePriceUsd: 7.50 },
  FHD: { label: 'Full HD', resolution: 'FHD', basePriceUsd: 11.50 },
  UHD: { label: '4K',      resolution: 'UHD', basePriceUsd: 20.00 },
}

const RETENTION_DAYS = [1, 3, 7, 15, 30, 90, 180]

const RETENTION_MULTIPLIER: Record<number, number> = {
  1:   0.35,
  3:   0.55,
  7:   1.00,
  15:  1.47,
  30:  2.12,
  90:  4.27,
  180: 7.50,
}

// Tagline por duração (curta, descritiva pro card)
const RETENTION_TAGLINE: Record<number, string> = {
  1:   'Mínimo legal',
  3:   'Curto prazo',
  7:   'Semanal',
  15:  'Quinzenal',
  30:  'Mais popular',
  90:  'Conformidade trimestral',
  180: 'Conformidade semestral',
}

function buildStorageProducts() {
  type Product = {
    slug:         string
    category:     'STORAGE'
    name:         string
    tagline:      string
    basePriceUsd: number
    sortOrder:    number
    features:     string[]
    metadata:     Record<string, any>
  }

  const products: Product[] = []
  const qualityKeys = Object.keys(QUALITY_BASE_USD)

  // sortOrder = 100 + (índice qualidade × 10) + índice retenção
  //   garante agrupamento por qualidade na listagem
  for (let qi = 0; qi < qualityKeys.length; qi++) {
    const qKey = qualityKeys[qi]
    const q = QUALITY_BASE_USD[qKey]

    for (let ri = 0; ri < RETENTION_DAYS.length; ri++) {
      const days = RETENTION_DAYS[ri]
      const price = Number((q.basePriceUsd * RETENTION_MULTIPLIER[days]).toFixed(2))

      products.push({
        slug:         `storage-${q.resolution.toLowerCase()}-${days}d`,
        category:     'STORAGE',
        name:         `${q.label} · ${days} dia${days > 1 ? 's' : ''}`,
        tagline:      RETENTION_TAGLINE[days],
        basePriceUsd: price,
        sortOrder:    100 + qi * 10 + ri,
        features: [
          `Gravação ${q.label}${q.label === 'SD' ? ' 480p' : q.label === 'HD' ? ' 720p' : q.label === 'Full HD' ? ' 1080p' : ' 4K'}`,
          `${days} ${days === 1 ? 'dia' : 'dias'} de histórico`,
          'Motion gate incluso',
          'Lifecycle automático no R2',
        ],
        metadata: {
          retainDays: days,
          resolution: q.resolution,
          ...(days === 30 ? { popular: true } : {}),
        },
      })
    }
  }
  return products
}

const STORAGE_PRODUCTS = buildStorageProducts()

// ── Produtos não-storage (timelapse, IA) — inalterados ──────────────────────
const OTHER_PRODUCTS = [
  // ── Timelapse ──────────────────────────────────────────────────────────────
  {
    slug: 'timelapse-daily',
    category: 'TIMELAPSE',
    name: 'Timelapse Diário',
    tagline: '1 vídeo por dia',
    basePriceUsd: 1.50,
    sortOrder: 201,
    pricingModel: 'PER_CAMERA_MONTH',
    features: ['1 vídeo/dia ≈ 60s', '30 dias de arquivo', 'Download e compartilhamento'],
    metadata: { type: 'DAILY', retentionDays: 30 },
  },
  {
    slug: 'timelapse-weekly',
    category: 'TIMELAPSE',
    name: 'Timelapse Semanal',
    tagline: '1 vídeo por semana',
    basePriceUsd: 2.00,
    sortOrder: 202,
    pricingModel: 'PER_CAMERA_MONTH',
    features: ['1 vídeo/semana ≈ 90s', '90 dias de arquivo', 'Download e compartilhamento'],
    metadata: { type: 'WEEKLY', retentionDays: 90 },
  },
  {
    slug: 'timelapse-monthly',
    category: 'TIMELAPSE',
    name: 'Timelapse Mensal',
    tagline: '1 vídeo por mês',
    basePriceUsd: 3.00,
    sortOrder: 203,
    pricingModel: 'PER_CAMERA_MONTH',
    features: ['1 vídeo/mês ≈ 3 min', '365 dias de arquivo', 'Download e compartilhamento'],
    metadata: { type: 'MONTHLY', retentionDays: 365 },
  },
  // ── IA (em breve) ──────────────────────────────────────────────────────────
  {
    slug: 'ai-detection',
    category: 'AI',
    name: 'Detecção IA',
    tagline: 'Pessoas, veículos, objetos',
    basePriceUsd: 8.00,
    sortOrder: 301,
    comingSoon: true,
    features: ['Detecção YOLOv8', 'Alertas em tempo real', 'Histórico de eventos'],
    metadata: {},
  },
  {
    slug: 'ai-lpr',
    category: 'AI',
    name: 'LPR — Leitura de Placa',
    tagline: 'Reconhecimento automático',
    basePriceUsd: 12.00,
    sortOrder: 302,
    comingSoon: true,
    features: ['Leitura de placa veicular', 'Lista branca/negra', 'Histórico de acessos'],
    metadata: {},
  },
  {
    slug: 'ai-heatmap',
    category: 'AI',
    name: 'Mapa de Calor',
    tagline: 'Análise de fluxo',
    basePriceUsd: 6.00,
    sortOrder: 303,
    comingSoon: true,
    features: ['Heatmap de movimento', 'Contagem de pessoas', 'Relatório diário'],
    metadata: {},
  },
]

const PRODUCTS = [...STORAGE_PRODUCTS, ...OTHER_PRODUCTS]

async function main() {
  console.log(`Seeding ${PRODUCTS.length} marketplace products (${STORAGE_PRODUCTS.length} STORAGE · ${OTHER_PRODUCTS.length} outros)...`)

  for (const p of PRODUCTS) {
    const { pricingModel, ...rest } = p as any
    await prisma.marketplaceProduct.upsert({
      where: { slug: p.slug },
      update: {
        ...rest,
        pricingModel: pricingModel ?? 'PER_CAMERA_MONTH',
        active:       true,
        metadata: rest.metadata ?? undefined,
      } as any,
      create: {
        ...rest,
        pricingModel: pricingModel ?? 'PER_CAMERA_MONTH',
        metadata: rest.metadata ?? undefined,
      } as any,
    })
    console.log(`  upserted: ${p.slug.padEnd(22)} · USD ${(p.basePriceUsd as number).toFixed(2).padStart(7)}/cam/mês`)
  }

  // ── Desativa STORAGE legados fora da matriz oficial ──────────────────────
  // Mantém o registro pra subscriptions antigas não quebrarem, só esconde do
  // marketplace. Matriz oficial: SD/HD/FHD/UHD × {1,3,7,15,30,90,180} dias.
  const officialSlugs = new Set(STORAGE_PRODUCTS.map(p => p.slug))
  const legacyStorage = await prisma.marketplaceProduct.findMany({
    where: { category: 'STORAGE', active: true },
    select: { id: true, slug: true },
  })
  const toDeactivate = legacyStorage.filter(p => !officialSlugs.has(p.slug))
  if (toDeactivate.length > 0) {
    await prisma.marketplaceProduct.updateMany({
      where: { id: { in: toDeactivate.map(p => p.id) } },
      data:  { active: false },
    })
    console.log(`\n🗑  ${toDeactivate.length} produtos STORAGE legados desativados:`)
    toDeactivate.forEach(p => console.log(`    - ${p.slug}`))
  }

  console.log('\nDone.')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
