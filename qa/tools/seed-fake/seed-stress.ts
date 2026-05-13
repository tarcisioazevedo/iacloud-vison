/**
 * seed-stress — cria N câmeras CLOUD_DIRECT prontas pra RTMP push fake.
 *
 * Diferente de seed.ts (que é DB-only pra testar queries), este cria:
 *   - Integrador + Cliente + Site + Câmeras (prefixo qa-stress-)
 *   - rtmpIngestKey cifrada (real, pode push de verdade)
 *   - go2rtcStreamId setado pra qa_stress_NNN (igual à key)
 *   - active=true, recordEnabled=true, deploymentMode=CLOUD_DIRECT
 *
 * Output:
 *   /tmp/qa-stress-keys.txt — uma key por linha pra obs-fleet usar.
 *
 * Uso:
 *   docker exec -w /app -e NODE_ENV=staging iacloud_backend.X \
 *     npx tsx /app/src/lib/_seed-stress.ts --cameras 20
 *
 * Cleanup: cleanup.ts apaga tudo qa-stress-* + qa-fake-* (mesmo padrão).
 */
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'
import { writeFileSync } from 'fs'
import { generateRtmpStreamKey } from './rtmp-key'
import { encryptSecret } from './crypto'

const prisma = new PrismaClient()

function parseArgs(): { cameras: number; outputFile: string } {
  const args = process.argv.slice(2)
  let cameras = 20
  let outputFile = '/tmp/qa-stress-keys.txt'
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--cameras') cameras = parseInt(args[i + 1], 10)
    if (args[i] === '--output')  outputFile = args[i + 1]
  }
  return { cameras, outputFile }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ NODE_ENV=production — RECUSO popular qa-stress em prod.')
    process.exit(1)
  }

  const { cameras: N, outputFile } = parseArgs()
  console.log(`=== seed-stress: ${N} câmeras CLOUD_DIRECT ===\n`)

  // Reaproveita integrador/cliente/site qa-stress se já existir
  let intId: string
  const existingInt = await prisma.integrador.findFirst({
    where: { name: 'qa-stress-integ' },
    select: { id: true },
  })
  if (existingInt) {
    intId = existingInt.id
    console.log('→ Reusando integrador qa-stress existente')
  } else {
    intId = randomUUID()
    await prisma.integrador.create({
      data: {
        id: intId,
        name: 'qa-stress-integ',
        cnpj: '88000000000000',
        email: 'qa-stress@example.test',
        passwordHash: '$qa$stress$do-not-login',
        active: true,
      },
    })
    console.log('→ Integrador qa-stress criado')
  }

  let cfId: string
  const existingCf = await prisma.clienteFinal.findFirst({
    where: { name: 'qa-stress-cliente' },
    select: { id: true },
  })
  if (existingCf) {
    cfId = existingCf.id
    console.log('→ Reusando cliente qa-stress existente')
  } else {
    cfId = randomUUID()
    await prisma.clienteFinal.create({
      data: {
        id: cfId,
        integradorId: intId,
        name:  'qa-stress-cliente',
        email: 'qa-stress-cliente@example.test',
        vertical: 'RETAIL' as any,
        active: true,
      },
    })
    console.log('→ ClienteFinal qa-stress criado')
  }

  let siteId: string
  const existingSite = await prisma.site.findFirst({
    where: { name: 'qa-stress-site' },
    select: { id: true },
  })
  if (existingSite) {
    siteId = existingSite.id
    console.log('→ Reusando site qa-stress existente')
  } else {
    siteId = randomUUID()
    await prisma.site.create({
      data: {
        id: siteId,
        clienteFinalId: cfId,
        name: 'qa-stress-site',
        address: 'QA Stress, 0',
        city: 'São Paulo',
        state: 'SP',
        country: 'BR',
        timezone: 'America/Sao_Paulo',
      },
    })
    console.log('→ Site qa-stress criado')
  }

  // Apaga câmeras qa-stress anteriores pra recomeçar limpo
  const oldCams = await prisma.camera.deleteMany({
    where: { name: { startsWith: 'qa-stress-cam-' } },
  })
  if (oldCams.count > 0) console.log(`→ ${oldCams.count} câmeras qa-stress antigas apagadas`)

  // Cria N câmeras com key real + grava em arquivo
  console.log(`→ Criando ${N} câmeras CLOUD_DIRECT com rtmpIngestKey real...`)
  const keys: string[] = []
  for (let i = 0; i < N; i++) {
    const key = generateRtmpStreamKey()
    keys.push(key)
    await prisma.camera.create({
      data: {
        id:                randomUUID(),
        siteId,
        name:              `qa-stress-cam-${i.toString().padStart(3, '0')}`,
        deploymentMode:    'CLOUD_DIRECT',
        ingestMode:        'RTMP_PUSH',
        status:            'ACTIVE',
        active:            true,
        recordEnabled:     true,
        recordMode:        'MOTION' as any,
        codec:             'h264' as any,
        tier:              'BRONZE' as any,
        pipeline:          'VERTEX_STREAMING' as any,
        rtspMainUrl:       `rtsp://qa-stress/${i}/main`,
        rtmpIngestKeyEnc:  encryptSecret(key),
        go2rtcStreamId:    key,    // mesma key pra simplificar lookup
        updatedAt:         new Date(),
      },
    })
  }

  writeFileSync(outputFile, keys.join('\n') + '\n')
  console.log(`\n✓ ${N} câmeras criadas. Keys salvas em ${outputFile}`)
  console.log(`  Sample: ${keys[0]}`)
  console.log(`  ...`)
  console.log(`\nPróximo: atualizar go2rtc.yaml com as ${N} streams + rodar pushers`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
