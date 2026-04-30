const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient({
  datasources: { db: { url: 'postgresql://icvuser:icvpass@localhost:5432/iacloudvision' } }
})

async function main() {
  const r = await p.analyticsEvent.deleteMany({ where: { cameraId: 'cam-demo-001' } })
  console.log('DELETED events:', r)
}

main().catch(console.error).finally(() => p.$disconnect())
