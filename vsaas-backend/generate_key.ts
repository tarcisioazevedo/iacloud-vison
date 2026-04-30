import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'

const prisma = new PrismaClient()

function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const segments: string[] = []
  for (let s = 0; s < 4; s++) {
    let seg = ''
    for (let i = 0; i < 4; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)]
    }
    segments.push(seg)
  }
  return `IACV-${segments.join('-')}`
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

async function run() {
  const node = await prisma.edgeNode.findFirst({
    where: { serialNumber: 'ICV-EDGE-001' }
  })
  
  if (!node) {
    console.log("Edge node ICV-EDGE-001 not found.")
    return
  }

  const rawKey = generateLicenseKey()
  const hashed = hashKey(rawKey)

  await prisma.edgeNode.update({
    where: { id: node.id },
    data: { apiToken: hashed }
  })

  console.log(`\n✅ LICENSE_KEY_GENERATED_SUCCESSFULLY\n`)
  console.log(`Serial: ICV-EDGE-001`)
  console.log(`Raw License Key (COPY THIS): ${rawKey}\n`)
}

run().catch(console.error).finally(() => prisma.$disconnect())
