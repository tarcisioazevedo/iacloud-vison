/**
 * Seed do catálogo de RetentionPlan (Sprint 2).
 * Idempotente — pode rodar múltiplas vezes (upsert por slug).
 *
 * Pricing strategy:
 *   - Referência: tabela pública Monuv 2026-05 (extraída em INCREMENTOS/)
 *   - Posicionamento: IACloud cobra do INTEGRADOR ~15% abaixo do "atacado
 *     equivalente Monuv" (Monuv-CF / 1.30 markup INT). Após o INT aplicar
 *     30% de markup, o preço final ao CF fica ~30% abaixo do Monuv direto.
 *   - costR2EstimatedUsd: storage R2 ($0.015/GB-mês) sobre o volume médio
 *     estimado para a resolução (motion 50%) × dias de retenção.
 *
 * Para regenerar/atualizar, rode dentro do container backend:
 *   docker exec <backend> npx tsx prisma/seed-retention-plans.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const USD_BRL = 5.30

// GB/dia médio estimado por resolução (motion 50%, H.264 padrão).
// Usado APENAS para `costR2EstimatedUsd` (referência interna).
const GB_PER_DAY: Record<string, number> = {
  VGA:    0.5,
  HD:     5,
  FHD:    12,
  UHD_4K: 30,
}

// Tabela Monuv (R$/cam/mês cobrado ao Cliente Final, conforme captura 2026-05-06).
// Será divida por 1.30 (markup INT default) para obter o "atacado Monuv" e
// depois multiplicada por 0.85 (15% abaixo) para definir o preço IACloud.
const MONUV_BRL: Record<string, Record<number, number | null>> = {
  VGA:    { 0:  4.9, 1: 17.1, 3:  20.5, 7:  22.8, 15:  34.3, 30:  45.7, 45:  57.1, 60:  68.6, 90: 102.9, 180: 179.0 },
  HD:     { 0:  4.9, 1: 19.4, 3:  22.8, 7:  34.3, 15:  45.7, 30:  68.6, 45:  91.5, 60: 114.4, 90: 171.6, 180: null  },
  FHD:    { 0:  4.9, 1: 20.5, 3:  34.3, 7:  45.7, 15:  80.0, 30: 114.4, 45: 160.1, 60: 205.9, 90: 331.8, 180: null  },
  UHD_4K: { 0:  4.9, 1: 45.7, 3:  57.1, 7:  88.0, 15: 148.7, 30: 183.0, 45: 274.5, 60: 331.8, 90: 469.1, 180: null  },
}

function priceUsd(resolution: keyof typeof MONUV_BRL, days: number): number | null {
  const monuvBrl = MONUV_BRL[resolution][days]
  if (monuvBrl == null) return null
  // (Monuv-CF ÷ markup INT 1.30) ÷ câmbio = atacado equivalente em USD
  // × 0.85 = posicionamento 15% abaixo
  return Number(((monuvBrl / 1.30 / USD_BRL) * 0.85).toFixed(4))
}

function costR2Usd(resolution: string, days: number): number | null {
  if (days === 0) return 0.10  // live-only: ~$0.10/cam/mês de overhead operacional
  const gbPerDay = GB_PER_DAY[resolution]
  if (!gbPerDay) return null
  // Volume médio armazenado (GB) ≈ gbPerDay × dias  (estado estável após enchido)
  const avgGb = gbPerDay * days
  return Number((avgGb * 0.015).toFixed(4))
}

async function main() {
  console.log('🌱 Seeding RetentionPlan catalog...')

  const resolutions: ('VGA' | 'HD' | 'FHD' | 'UHD_4K')[] = ['VGA', 'HD', 'FHD', 'UHD_4K']
  const allDays = [0, 1, 3, 7, 15, 30, 45, 60, 90, 180]

  let created = 0, updated = 0, skipped = 0

  // ── Plano especial "live only" (compartilhado entre todas resoluções) ──────
  // No Monuv, "0 dias" custa R$ 4,90 igual em todas resoluções — efetivamente
  // é o mesmo plano. Aqui criamos como ANY/0d para evitar duplicação.
  const liveSlug = 'live-only'
  const livePriceUsd = (4.90 / 1.30 / USD_BRL) * 0.85
  await prisma.retentionPlan.upsert({
    where: { slug: liveSlug },
    update: {
      pricePerCameraMonthUsd: Number(livePriceUsd.toFixed(4)),
      costR2EstimatedUsd:     0.10,
      active:                 true,
    },
    create: {
      slug:                   liveSlug,
      name:                   'Live Only — sem gravação',
      retainDays:             0,
      resolution:             'ANY',
      pricePerCameraMonthUsd: Number(livePriceUsd.toFixed(4)),
      costR2EstimatedUsd:     0.10,
      description:            'Apenas streaming ao vivo, sem armazenamento de gravações.',
      sortOrder:              0,
    },
  })
  console.log(`  ✓ ${liveSlug.padEnd(22)}  USD ${livePriceUsd.toFixed(4)}/cam/mês`)
  created++

  // ── Demais planos por (resolução × dias) ───────────────────────────────────
  for (const res of resolutions) {
    for (const days of allDays) {
      if (days === 0) continue   // tratado pelo plano live-only acima
      const priceUSD = priceUsd(res, days)
      if (priceUSD == null) {
        skipped++
        continue                  // combinação não comercializada (ex: HD 180d)
      }
      const slug = `${res.toLowerCase().replace(/_/g, '')}-${days}d`
      const name = `${res === 'UHD_4K' ? '4K' : res} · ${days} dia${days > 1 ? 's' : ''}`
      const cost = costR2Usd(res, days)

      const existing = await prisma.retentionPlan.findUnique({ where: { slug } })

      await prisma.retentionPlan.upsert({
        where: { slug },
        update: {
          pricePerCameraMonthUsd: priceUSD,
          costR2EstimatedUsd:     cost ?? undefined,
          active:                 true,
        },
        create: {
          slug,
          name,
          retainDays:             days,
          resolution:             res,
          pricePerCameraMonthUsd: priceUSD,
          costR2EstimatedUsd:     cost ?? undefined,
          description:            `Gravação ${name} · armazenamento R2 + lifecycle automático.`,
          sortOrder:              days * 10 + (res === 'VGA' ? 1 : res === 'HD' ? 2 : res === 'FHD' ? 3 : 4),
        },
      })

      const margemPct = cost && priceUSD
        ? Math.round(((priceUSD - cost) / priceUSD) * 100)
        : null
      console.log(
        `  ✓ ${slug.padEnd(12)}  USD ${priceUSD.toFixed(4).padStart(8)}/cam/mês  ` +
        `(custo R2 ~${(cost ?? 0).toFixed(4)} = margem ${margemPct ?? '?'}%)`
      )
      existing ? updated++ : created++
    }
  }

  console.log(`\n📊 ${created} criados · ${updated} atualizados · ${skipped} pulados`)

  const total = await prisma.retentionPlan.count({ where: { active: true } })
  console.log(`📦 Catálogo final: ${total} planos ativos`)
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
