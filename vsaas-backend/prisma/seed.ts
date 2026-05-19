/**
 * Seed de desenvolvimento — cria dados iniciais para testar o sistema.
 * Executar: npm run db:seed
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

function requiredSeedPassword(envName: string): string {
  const value = process.env[envName]
  if (!value || value.length < 12) {
    throw new Error(envName + ' must be set with at least 12 characters before running db:seed')
  }
  return value
}

async function main() {
  console.log('Seeding database...')

  const superAdminPassword = requiredSeedPassword('SEED_SUPER_ADMIN_PASSWORD')
  const integradorPassword = requiredSeedPassword('SEED_INTEGRADOR_PASSWORD')
  const operadorPassword = requiredSeedPassword('SEED_OPERADOR_PASSWORD')

  // SuperAdmin
  const superAdmin = await prisma.superAdmin.upsert({
    where: { email: 'admin@iacloudvision.com.br' },
    update: {},
    create: {
      name:         'Super Admin',
      email:        'admin@iacloudvision.com.br',
      passwordHash: await bcrypt.hash(superAdminPassword, 12),
    },
  })
  console.log('SuperAdmin:', superAdmin.email)

  // Integrador
  const integrador = await prisma.integrador.upsert({
    where: { email: 'integrador@visaocorp.com.br' },
    update: {},
    create: {
      name:         'VisionCorp Integrações',
      tradeName:    'VisionCorp',
      email:        'integrador@visaocorp.com.br',
      passwordHash: await bcrypt.hash(integradorPassword, 12),
      phone:        '11 99999-0001',
    },
  })
  console.log('✅ Integrador:', integrador.email)

  // Cria User INTEGRADOR_ADMIN linkado — necessário pra impersonate funcionar
  // (rota /auth/impersonate busca User com role=INTEGRADOR_ADMIN, não a tabela
  // Integrador). Bug encontrado em 2026-05-08.
  await prisma.user.upsert({
    where: { email: integrador.email },
    update: {
      integradorId: integrador.id,
      role:         'INTEGRADOR_ADMIN',
      active:       true,
    },
    create: {
      name:           integrador.name,
      email:          integrador.email,
      passwordHash:   integrador.passwordHash,
      role:           'INTEGRADOR_ADMIN',
      integradorId:   integrador.id,
      mustChangePassword: true,
    },
  })

  // Quota do integrador
  const now         = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  await prisma.apiQuota.upsert({
    where: { integradorId_periodStart: { integradorId: integrador.id, periodStart } },
    update: {},
    create: {
      integradorId:             integrador.id,
      staticVisionMonthlyLimit: 50000,
      streamingMinutesLimit:    6000,
      periodStart,
      periodEnd,
    },
  })

  // ── Cliente Final ─────────────────────────────────────────
  // ClienteFinal não tem campo @unique além do id, então idempotência é
  // por findFirst + create. ID gerado pelo Prisma (@default(uuid())) — não
  // hardcoded em slug, evita o problema legacy resolvido em 2026-05-06.
  const clienteExistente = await prisma.clienteFinal.findFirst({
    where: { integradorId: integrador.id, name: 'Shopping Boa Vista' },
  })
  const cliente = clienteExistente ?? await prisma.clienteFinal.create({
    data: {
      integradorId: integrador.id,
      name:         'Shopping Boa Vista',
      email:        'ti@shoppingboavista.com.br',
      vertical:     'SHOPPING_MALL',
      city:         'São Paulo',
      state:        'SP',
    },
  })
  console.log('✅ ClienteFinal:', cliente.name)

  await prisma.user.upsert({
    where: { email: 'operador@shoppingboavista.com.br' },
    update: { integradorId: cliente.integradorId },
    create: {
      name:           'Operador Demo',
      email:          'operador@shoppingboavista.com.br',
      passwordHash:   await bcrypt.hash(operadorPassword, 12),
      role:           'CLIENTE_OPERADOR',
      clienteFinalId: cliente.id,
      // integradorId é herdado do clienteFinal — necessário pro impersonate
      // validar ownership via JWT.integradorId === target.integradorId
      integradorId:   cliente.integradorId,
    },
  })

  // ── Site ──────────────────────────────────────────────────
  // Site também não tem @unique além do id; idempotência por nome+cliente.
  const siteExistente = await prisma.site.findFirst({
    where: { clienteFinalId: cliente.id, name: 'Piso Térreo' },
  })
  const site = siteExistente ?? await prisma.site.create({
    data: {
      clienteFinalId: cliente.id,
      name:           'Piso Térreo',
      city:           'São Paulo',
      state:          'SP',
      latitude:       -23.5505,
      longitude:      -46.6333,
    },
  })
  console.log('✅ Site:', site.name)

  // ── Edge Node ─────────────────────────────────────────────
  const edge = await prisma.edgeNode.upsert({
    where: { serialNumber: 'ICV-EDGE-001' },
    update: {},
    create: {
      siteId:        site.id,
      serialNumber:  'ICV-EDGE-001',
      name:          'Edge Node — Entrada',
      model:         'Raspberry Pi 5',
      accelerator:   'Hailo-8L',
      apiToken:      'dev-edge-token-001',
      status:        'ONLINE',
      lastHeartbeat: new Date(),
    },
  })
  console.log('✅ EdgeNode token:', edge.apiToken)

  // ── Câmera + Zona + Modelos + Assinatura ──────────────────
  // Idempotência: Camera por (siteId, name) — não há @unique composto, então findFirst.
  const camExistente = await prisma.camera.findFirst({
    where: { siteId: site.id, name: 'Entrada Principal' },
  })
  const cam = camExistente ?? await prisma.camera.create({
    data: {
      siteId:      site.id,
      edgeNodeId:  edge.id,
      name:        'Entrada Principal',
      location:    'Portaria Norte — Piso Térreo',
      rtspMainUrl: 'rtsp://admin:admin@192.168.1.101:554/stream1',
      rtspSubUrl:  'rtsp://admin:admin@192.168.1.101:554/stream2',
      tier:        'STATIC_VISION',
      pipeline:    'EDGE_HYBRID',
      brand:       'Hikvision',
      resolution:  '1920x1080',
      fps:         25,
      status:      'ACTIVE',
    },
  })

  const zoneExistente = await prisma.cameraZone.findFirst({
    where: { cameraId: cam.id, name: 'Tripwire Entrada' },
  })
  if (!zoneExistente) await prisma.cameraZone.create({
    data: {
      cameraId:    cam.id,
      name:        'Tripwire Entrada',
      type:        'COUNTING_LINE',
      coordinates: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
      direction:   'BOTH',
    },
  })

  for (const model of ['FACE_ANNOTATION', 'LABEL_DETECTION', 'LOGO_DETECTION', 'PEOPLE_COUNTING']) {
    await prisma.cameraModel.upsert({
      where: { cameraId_model: { cameraId: cam.id, model: model as any } },
      update: {},
      create: { cameraId: cam.id, model: model as any, enabled: true },
    })
  }

  await prisma.cameraSubscription.upsert({
    where: { cameraId: cam.id },
    update: {},
    create: {
      cameraId:        cam.id,
      tier:            'STATIC_VISION',
      monthlyApiLimit: 10000,
      priceMonthlyBrl: 89.90,
      startDate:       new Date(),
      renewDate:       new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  })
  console.log('✅ Câmera:', cam.name)

  // ── Módulos do Integrador (grant do SuperAdmin) ───────────
  const integradorModules = [
    'FACE_ANNOTATION', 'LABEL_DETECTION', 'LOGO_DETECTION',
    'OBJECT_LOCALIZATION', 'SAFE_SEARCH',
    'PEOPLE_COUNTING', 'OCCUPANCY_ANALYTICS', 'PPE_DETECTION',
    'VEHICLE_DETECTION', 'CROWD_DENSITY', 'QUEUE_LENGTH',
  ] as const

  for (const mod of integradorModules) {
    await prisma.integradorModule.upsert({
      where: { integradorId_module: { integradorId: integrador.id, module: mod } },
      update: {},
      create: {
        integradorId: integrador.id,
        module:       mod,
        enabled:      true,
        grantedBy:    superAdmin.id,
      },
    })
  }
  console.log(`✅ ${integradorModules.length} módulos concedidos ao integrador`)

  // ── Módulos do ClienteFinal (subset escolhido pelo Integrador) ─
  const clienteModules = [
    'FACE_ANNOTATION', 'LABEL_DETECTION',
    'PEOPLE_COUNTING', 'OCCUPANCY_ANALYTICS', 'QUEUE_LENGTH',
  ] as const

  for (const mod of clienteModules) {
    await prisma.clienteFinalModule.upsert({
      where: { clienteFinalId_module: { clienteFinalId: cliente.id, module: mod } },
      update: {},
      create: {
        clienteFinalId: cliente.id,
        module:         mod,
        enabled:        true,
        grantedBy:      integrador.id,
      },
    })
  }
  console.log(`✅ ${clienteModules.length} módulos concedidos ao cliente final`)

  // ── Events de exemplo ─────────────────────────────────────
  for (let i = 0; i < 20; i++) {
    await prisma.analyticsEvent.create({
      data: {
        cameraId:        cam.id,
        zoneId:          'zone-demo-001',
        model:           'FACE_ANNOTATION',
        pipeline:        'EDGE_HYBRID',
        eventType:       i % 2 === 0 ? 'LINE_CROSS_IN' : 'LINE_CROSS_OUT',
        severity:        'INFO',
        capturedAt:      new Date(Date.now() - i * 8 * 60_000),
        processedAt:     new Date(Date.now() - i * 8 * 60_000 + 800),
        dominantEmotion: ['joy', 'neutral', 'surprise'][i % 3],
        emotionJoy:      Math.random(),
        emotionSorrow:   Math.random() * 0.3,
        hasHat:          i % 4 === 0,
        hasGlasses:      i % 3 === 0,
        labelsJson:      ['blue shirt', 'shopping bag', 'sneakers'],
        occupancyCount:  Math.floor(Math.random() * 20) + 1,
        evidenceExpiry:  new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    })
  }
  console.log('✅ 20 AnalyticsEvents de exemplo')

  console.log('')
  console.log('Seed completed')
  console.log('Seed accounts created from SEED_* environment variables')
  console.log('SuperAdmin: admin@iacloudvision.com.br')
  console.log('Integrador: integrador@visaocorp.com.br')
  console.log('Operador: operador@shoppingboavista.com.br')
  console.log('Edge Token: dev-edge-token-001')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
