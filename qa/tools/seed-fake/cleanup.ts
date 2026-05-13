/**
 * cleanup.ts — apaga TODOS os dados com prefixo `qa-fake-` criados pelo
 * seed.ts. Ordem de delete respeita FK constraints.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== cleanup seed-fake ===\n')

  const counts: Record<string, number> = {}

  // 1. RecordingSegment com storagePath qa-fake-
  const segs = await prisma.recordingSegment.deleteMany({
    where: { storagePath: { contains: 'qa-fake-' } },
  })
  counts['RecordingSegment'] = segs.count

  // 2. Câmeras qa-fake-
  const cams = await prisma.camera.deleteMany({
    where: { name: { startsWith: 'qa-fake-cam-' } },
  })
  counts['Camera'] = cams.count

  // 3. Sites qa-fake-
  const sites = await prisma.site.deleteMany({
    where: { name: { startsWith: 'qa-fake-site-' } },
  })
  counts['Site'] = sites.count

  // 4. ClientesFinais qa-fake-
  const cf = await prisma.clienteFinal.deleteMany({
    where: { name: { startsWith: 'qa-fake-cliente-' } },
  })
  counts['ClienteFinal'] = cf.count

  // 5. Integradores qa-fake-
  const int = await prisma.integrador.deleteMany({
    where: { name: { startsWith: 'qa-fake-integ-' } },
  })
  counts['Integrador'] = int.count

  for (const [tbl, c] of Object.entries(counts)) {
    console.log(`  ${tbl}: ${c} deletados`)
  }
  console.log('\n✓ Cleanup completo.')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
