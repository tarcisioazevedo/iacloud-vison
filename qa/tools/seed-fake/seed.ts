/**
 * seed-fake — popula DB com massa de clientes/câmeras/segments pra testar
 * comportamento em escala.
 *
 * Sprint γ-Day2 (2026-05-12). Usado pra CG12 ("500+ câmeras cadastradas")
 * e CG16/CG20 (DB sob carga).
 *
 * Uso (rodar DENTRO do container backend com env já carregado):
 *   docker exec -w /app iacloud_backend.X npx tsx /opt/qa/tools/seed-fake/seed.ts \
 *     --integradores 5 --clientes 100 --cameras 1000 --segments 50000
 *
 * Defaults:   5 integradores, 100 clientes, 1000 câmeras, 50k segments
 *
 * IMPORTANTE:
 *   - Roda SÓ em ambiente de QA/staging (checa NODE_ENV != production).
 *   - Cria com prefixo `qa-fake-` em nomes pra fácil cleanup depois.
 *   - Cleanup: ./cleanup.ts (apaga tudo com prefixo `qa-fake-`).
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID, randomBytes } from 'crypto'

const prisma = new PrismaClient()

function parseArgs(): Record<string, number> {
  const args = process.argv.slice(2)
  const out: Record<string, number> = {
    integradores: 5,
    clientes:     100,
    cameras:      1000,
    segments:     50_000,
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '')
    out[key] = parseInt(args[i + 1], 10)
  }
  return out
}

async function safetyCheck() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ NODE_ENV=production — RECUSO popular fake data em prod.')
    process.exit(1)
  }
  const existing = await prisma.clienteFinal.count({ where: { name: { startsWith: 'qa-fake-' } } })
  if (existing > 0) {
    console.warn(`⚠ ${existing} clientes 'qa-fake-' já existem. Rode cleanup.ts primeiro.`)
  }
}

async function seed() {
  const args = parseArgs()
  console.log('=== seed-fake ===')
  console.log('args:', args)
  await safetyCheck()

  const t0 = Date.now()
  console.log(`\n→ Criando ${args.integradores} integradores...`)

  const integradorIds: string[] = []
  for (let i = 0; i < args.integradores; i++) {
    const id = randomUUID()
    integradorIds.push(id)
    await prisma.integrador.create({
      data: {
        id,
        name:  `qa-fake-integ-${i.toString().padStart(3, '0')}`,
        // slug:  `qa-fake-int-${i}`,  // não existe na coluna
        cnpj:  `99${i.toString().padStart(12, '0')}`,
        email: `qa-fake-int${i}@example.test`,
        passwordHash: '$qa$fake$do-not-login',  // bcrypt placeholder
        active: true,
      },
    })
  }

  console.log(`→ Criando ${args.clientes} clientes finais...`)
  const clienteIds: string[] = []
  for (let i = 0; i < args.clientes; i++) {
    const id = randomUUID()
    clienteIds.push(id)
    const intId = integradorIds[i % integradorIds.length]
    await prisma.clienteFinal.create({
      data: {
        id,
        integradorId: intId,
        name:    `qa-fake-cliente-${i.toString().padStart(4, '0')}`,
        email:   `qa-fake-cf${i}@example.test`,
        vertical: 'RETAIL' as any,
        active:  true,
      },
    })
  }

  console.log(`→ Criando ${args.clientes} sites (1 por cliente)...`)
  const siteIds: string[] = []
  for (let i = 0; i < args.clientes; i++) {
    const id = randomUUID()
    siteIds.push(id)
    await prisma.site.create({
      data: {
        id,
        clienteFinalId: clienteIds[i],
        name:    `qa-fake-site-${i.toString().padStart(4, '0')}`,
        address: 'Rua Fake QA, 123',
        city:    'São Paulo',
        state:   'SP',
        country: 'BR',
        timezone: 'America/Sao_Paulo',
      },
    })
  }

  console.log(`→ Criando ${args.cameras} câmeras (distribuídas por sites)...`)
  const cameraIds: string[] = []
  // Batch insert pra performance (Prisma `createMany`)
  const BATCH = 100
  for (let off = 0; off < args.cameras; off += BATCH) {
    const batch: any[] = []
    const n = Math.min(BATCH, args.cameras - off)
    for (let i = 0; i < n; i++) {
      const idx = off + i
      const id = randomUUID()
      cameraIds.push(id)
      batch.push({
        id,
        siteId:         siteIds[idx % siteIds.length],
        name:           `qa-fake-cam-${idx.toString().padStart(5, '0')}`,
        deploymentMode: idx % 3 === 0 ? 'EDGE_BOX' : 'CLOUD_DIRECT',
        ingestMode:     idx % 3 === 0 ? 'RTSP_PULL' : 'RTMP_PUSH',
        status:         idx % 10 === 0 ? 'ERROR' : 'ACTIVE',
        active:         true,
        recordEnabled:  true,
        recordMode:     'MOTION' as any,
        codec:          'h264' as any,
        tier:           'BRONZE' as any,
        pipeline:       'EDGE_YOLO' as any,
        rtspMainUrl:    `rtsp://qa-fake/${id}/main`,
        rtspSubUrl:     `rtsp://qa-fake/${id}/sub`,
        updatedAt:      new Date(),
      })
    }
    await prisma.camera.createMany({ data: batch, skipDuplicates: true })
  }

  console.log(`→ Criando ${args.segments} segments (distribuídos por câmeras)...`)
  const SEG_DURATION = 6
  const SEG_BATCH = 500
  let segsCreated = 0
  const baseTime = Date.now() - 7 * 24 * 60 * 60_000 // 7d atrás
  for (let off = 0; off < args.segments; off += SEG_BATCH) {
    const segs: any[] = []
    const n = Math.min(SEG_BATCH, args.segments - off)
    for (let i = 0; i < n; i++) {
      const idx = off + i
      const cameraId = cameraIds[idx % cameraIds.length]
      const startedAt = new Date(baseTime + idx * 10_000) // espaçados 10s
      segs.push({
        id:           randomUUID(),
        cameraId,
        startedAt,
        endedAt:      new Date(startedAt.getTime() + SEG_DURATION * 1000),
        durationSec:  SEG_DURATION,
        sizeBytes:    BigInt(500_000 + Math.floor(Math.random() * 500_000)),
        // Prefixo `qa-fake-` no início do path pra cleanup.ts pegar.
        storagePath:  `qa-fake-${cameraId}/${startedAt.toISOString().slice(0,10)}/${idx}.ts`,
        codec:        'h264',
        uploadStatus: 'UPLOADED',
        uploadedAt:   new Date(),
        hasMotion:    idx % 4 === 0,
        hasEvent:     idx % 50 === 0,
        storageTier:  idx % 3 === 0 ? 'COLD' : 'HOT',
      })
    }
    await prisma.recordingSegment.createMany({ data: segs, skipDuplicates: true })
    segsCreated += segs.length
    if (segsCreated % 5000 === 0) {
      process.stdout.write(`  ${segsCreated}/${args.segments}\r`)
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n✓ Done em ${elapsed}s`)
  console.log(`  ${args.integradores} integradores`)
  console.log(`  ${args.clientes} clientes`)
  console.log(`  ${args.cameras} câmeras (${Math.round(args.cameras / 3)} EDGE_BOX + ${Math.round(args.cameras * 2 / 3)} CLOUD_DIRECT)`)
  console.log(`  ${args.segments} segments`)
  console.log(`\nCleanup:  npx tsx /opt/qa/tools/seed-fake/cleanup.ts`)
}

seed().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
