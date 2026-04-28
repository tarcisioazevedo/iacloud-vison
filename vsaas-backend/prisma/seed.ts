/**
 * Seed de desenvolvimento — cria dados iniciais para testar o sistema.
 * Executar: npm run db:seed
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ── SuperAdmin ────────────────────────────────────────────
  const superAdmin = await prisma.superAdmin.upsert({
    where: { email: 'admin@iacloudvision.com.br' },
    update: {},
    create: {
      name:         'Super Admin',
      email:        'admin@iacloudvision.com.br',
      passwordHash: await bcrypt.hash('Admin@123', 12),
    },
  })
  console.log('✅ SuperAdmin:', superAdmin.email)

  // ── Integrador ────────────────────────────────────────────
  const integrador = await prisma.integrador.upsert({
    where: { email: 'integrador@visaocorp.com.br' },
    update: {},
    create: {
      name:         'VisionCorp Integrações',
      tradeName:    'VisionCorp',
      email:        'integrador@visaocorp.com.br',
      passwordHash: await bcrypt.hash('Integrador@123', 12),
      phone:        '11 99999-0001',
    },
  })
  console.log('✅ Integrador:', integrador.email)

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
  const cliente = await prisma.clienteFinal.upsert({
    where: { id: 'cliente-demo-001' },
    update: {},
    create: {
      id:           'cliente-demo-001',
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
    update: {},
    create: {
      name:           'Operador Demo',
      email:          'operador@shoppingboavista.com.br',
      passwordHash:   await bcrypt.hash('Operador@123', 12),
      role:           'CLIENTE_OPERADOR',
      clienteFinalId: cliente.id,
    },
  })

  // ── Site ──────────────────────────────────────────────────
  const site = await prisma.site.upsert({
    where: { id: 'site-demo-001' },
    update: {},
    create: {
      id:             'site-demo-001',
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
  const cam = await prisma.camera.upsert({
    where: { id: 'cam-demo-001' },
    update: {},
    create: {
      id:          'cam-demo-001',
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

  await prisma.cameraZone.upsert({
    where: { id: 'zone-demo-001' },
    update: {},
    create: {
      id:          'zone-demo-001',
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

  console.log('\n🎉 Seed concluído!\n')
  console.log('┌─────────────────────────────────────────────────┐')
  console.log('│  Credenciais (DEV)                              │')
  console.log('│  SuperAdmin:  admin@iacloudvision.com.br        │')
  console.log('│  Senha:       Admin@123                         │')
  console.log('│  Integrador:  integrador@visaocorp.com.br       │')
  console.log('│  Senha:       Integrador@123                    │')
  console.log('│  Operador:    operador@shoppingboavista.com.br  │')
  console.log('│  Senha:       Operador@123                      │')
  console.log('│  Edge Token:  dev-edge-token-001                │')
  console.log('└─────────────────────────────────────────────────┘')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
