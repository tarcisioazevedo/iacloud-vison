/**
 * Script one-shot pra inserir 2 câmeras de teste no tenant "Shopping Boa Vista".
 *
 * Streams já validados via ffprobe (cliente confirmou execução):
 *   77c18e5d... → H.264+AAC · 1920×1080 · 25fps
 *   a784b68b... → H.264     ·  800×600  · 25fps
 *
 * Modo: CLOUD_DIRECT (sem edge box). go2rtc da cloud puxa do RTSP direto.
 *
 * Idempotente — usa upsert por (siteId + name).
 */
import '../lib/secrets-bootstrap'
import { prisma } from '../lib/prisma'

const RTSP_CAMS = [
  {
    rtspUrl:    'rtsp://135.181.32.149:8565/rtspServer/77c18e5d-4652-4c33-9fd9-514d8d622b32-0',
    name:       'Cam Teste Externa · FHD',
    description: 'RTSP teste · 1920×1080 H.264+AAC',
    resolution: '1920x1080',
  },
  {
    rtspUrl:    'rtsp://135.181.32.149:8565/rtspServer/a784b68b-7d5c-473b-b0e3-0e02fdb115f3-0',
    name:       'Cam Teste Externa · SD',
    description: 'RTSP teste · 800×600 H.264',
    resolution: '800x600',
  },
]

async function main() {
  // Acha o tenant Shopping Boa Vista
  const cliente = await prisma.clienteFinal.findFirst({
    where: { name: { contains: 'Shopping Boa Vista', mode: 'insensitive' } },
    select: { id: true, name: true, integradorId: true },
  })
  if (!cliente) {
    console.error('❌ ClienteFinal "Shopping Boa Vista" não encontrado.')
    process.exit(1)
  }
  console.log(`✓ ClienteFinal: ${cliente.name} (${cliente.id})`)

  // Acha o primeiro Site ativo. Se não existir, cria "Piso Térreo".
  let site = await prisma.site.findFirst({
    where:  { clienteFinalId: cliente.id, active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!site) {
    site = await prisma.site.create({
      data: {
        clienteFinalId: cliente.id,
        name:           'Piso Térreo',
        active:         true,
      },
      select: { id: true, name: true },
    })
    console.log(`✓ Site criado: ${site.name} (${site.id})`)
  } else {
    console.log(`✓ Site existente: ${site.name} (${site.id})`)
  }

  // Insere/atualiza câmeras
  for (const c of RTSP_CAMS) {
    const existing = await prisma.camera.findFirst({
      where:  { siteId: site.id, name: c.name },
      select: { id: true },
    })

    const data = {
      name:           c.name,
      description:    c.description,
      siteId:         site.id,
      deploymentMode: 'CLOUD_DIRECT' as const,
      rtspMainUrl:    c.rtspUrl,
      tier:           'BRONZE' as const,
      pipeline:       'EDGE_YOLO' as const,
      resolution:     c.resolution,
      codec:          'h264',
      fps:            25,
      active:         true,
      status:         'PENDING_CONFIG' as const,
      recordEnabled:  false, // cliente não tem plano STORAGE — só live
    } as const

    if (existing) {
      await prisma.camera.update({ where: { id: existing.id }, data })
      console.log(`  ✓ Atualizada: ${c.name} (${existing.id})`)
    } else {
      const created = await prisma.camera.create({ data, select: { id: true } })
      console.log(`  ✓ Criada:     ${c.name} (${created.id})`)
    }
  }

  const total = await prisma.camera.count({
    where: { site: { clienteFinalId: cliente.id } },
  })
  console.log(`\n📦 Total de câmeras no tenant ${cliente.name}: ${total}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
