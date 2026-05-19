/**
 * Seed de produtos iniciais do marketplace.
 * Execução: npx ts-node src/scripts/seed-marketplace-products.ts
 * Ou via docker exec (ver comentário abaixo).
 *
 * Idempotente via upsert por slug.
 */
import { prisma } from '../lib/prisma'

const PRODUCTS = [
  // ── Storage ────────────────────────────────────────────────────────────────
  {
    slug: 'storage-sd-7d',
    category: 'STORAGE',
    name: 'SD · 7 dias',
    tagline: 'Armazenamento básico',
    basePriceUsd: 4.90,
    sortOrder: 101,
    features: ['Gravação SD 480p', '7 dias de histórico', 'Motion gate incluso'],
    metadata: { retainDays: 7, resolution: 'SD' },
  },
  {
    slug: 'storage-hd-7d',
    category: 'STORAGE',
    name: 'HD · 7 dias',
    tagline: 'Entrada HD',
    basePriceUsd: 7.50,
    sortOrder: 102,
    features: ['Gravação HD 720p', '7 dias de histórico', 'Motion gate incluso'],
    metadata: { retainDays: 7, resolution: 'HD' },
  },
  {
    slug: 'storage-hd-15d',
    category: 'STORAGE',
    name: 'HD · 15 dias',
    tagline: 'Mais histórico',
    basePriceUsd: 11.00,
    sortOrder: 103,
    features: ['Gravação HD 720p', '15 dias de histórico', 'Alertas guardados 30d'],
    metadata: { retainDays: 15, resolution: 'HD' },
  },
  {
    slug: 'storage-hd-30d',
    category: 'STORAGE',
    name: 'HD · 30 dias',
    tagline: 'Mais popular',
    basePriceUsd: 15.90,
    sortOrder: 104,
    features: ['Gravação HD 720p', '30 dias de histórico', 'Alertas guardados 60d', 'Motion gate incluso'],
    metadata: { retainDays: 30, resolution: 'HD', popular: true },
  },
  {
    slug: 'storage-hd-60d',
    category: 'STORAGE',
    name: 'HD · 60 dias',
    tagline: 'Conformidade 2 meses',
    basePriceUsd: 24.00,
    sortOrder: 105,
    features: ['Gravação HD 720p', '60 dias de histórico', 'Alertas guardados 90d'],
    metadata: { retainDays: 60, resolution: 'HD' },
  },
  {
    slug: 'storage-hd-90d',
    category: 'STORAGE',
    name: 'HD · 90 dias',
    tagline: 'Conformidade trimestral',
    basePriceUsd: 32.00,
    sortOrder: 106,
    features: ['Gravação HD 720p', '90 dias de histórico', 'Alertas guardados 180d'],
    metadata: { retainDays: 90, resolution: 'HD' },
  },
  {
    slug: 'storage-fhd-30d',
    category: 'STORAGE',
    name: 'Full HD · 30d',
    tagline: 'Alta definição',
    basePriceUsd: 22.00,
    sortOrder: 107,
    features: ['Gravação Full HD 1080p', '30 dias', 'Alertas guardados 90d'],
    metadata: { retainDays: 30, resolution: 'FHD' },
  },
  {
    slug: 'storage-fhd-90d',
    category: 'STORAGE',
    name: 'Full HD · 90d',
    tagline: 'Alta def + conformidade',
    basePriceUsd: 45.00,
    sortOrder: 108,
    features: ['Gravação Full HD 1080p', '90 dias', 'Alertas guardados 180d'],
    metadata: { retainDays: 90, resolution: 'FHD' },
  },
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

async function main() {
  console.log(`Seeding ${PRODUCTS.length} marketplace products...`)

  for (const p of PRODUCTS) {
    const { pricingModel, ...rest } = p as any
    await prisma.marketplaceProduct.upsert({
      where: { slug: p.slug },
      update: {
        ...rest,
        pricingModel: pricingModel ?? 'PER_CAMERA_MONTH',
        metadata: rest.metadata ?? undefined,
      } as any,
      create: {
        ...rest,
        pricingModel: pricingModel ?? 'PER_CAMERA_MONTH',
        metadata: rest.metadata ?? undefined,
      } as any,
    })
    console.log(`  upserted: ${p.slug}`)
  }

  console.log('Done.')
  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
