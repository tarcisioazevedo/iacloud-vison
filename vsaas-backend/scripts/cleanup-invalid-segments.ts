/**
 * cleanup-invalid-segments — apaga segments do DB + bucket.
 *
 * Uso típico (descartar segments MP4 inválidos enviados antes do fix do ffmpeg):
 *   docker exec iacloud_backend npx tsx scripts/cleanup-invalid-segments.ts \
 *     --cameraId=<UUID> --since=2026-05-07T00:00:00Z [--dry-run]
 *
 * Ordem de exclusão:
 *   1. Resolve integradorId (pra bucket multi-tenant)
 *   2. Para cada segment: DELETE no R2/S3 → DELETE arquivo local → DELETE no DB
 *   3. Em batches de 100 pra evitar overload
 *
 * Idempotente: roda 2x não dá erro (objetos já apagados são ignorados).
 */
import { prisma } from '../src/lib/prisma'
import { recordingStorage } from '../src/services/recording-storage.service'
import { promises as fs } from 'fs'

interface Args {
  cameraId?: string
  since?:    string
  until?:    string
  dryRun:    boolean
  all:       boolean
}

function parseArgs(): Args {
  const out: Args = { dryRun: false, all: false }
  for (const arg of process.argv.slice(2)) {
    const m = /^--?([^=]+?)(?:=(.+))?$/.exec(arg)
    if (!m) continue
    const k = m[1]
    const v = m[2] ?? 'true'
    if (k === 'cameraId') out.cameraId = v
    else if (k === 'since') out.since = v
    else if (k === 'until') out.until = v
    else if (k === 'dry-run' || k === 'dryRun') out.dryRun = v === 'true'
    else if (k === 'all') out.all = v === 'true'
  }
  return out
}

async function main() {
  const args = parseArgs()

  if (!args.cameraId && !args.all) {
    console.error('Uso: --cameraId=<UUID> [--since=ISO] [--until=ISO] [--dry-run]')
    console.error('  ou: --all  (apaga TUDO — usar com cuidado)')
    process.exit(1)
  }

  const where: any = {}
  if (args.cameraId) where.cameraId = args.cameraId
  if (args.since) where.startedAt = { ...(where.startedAt ?? {}), gte: new Date(args.since) }
  if (args.until) where.startedAt = { ...(where.startedAt ?? {}), lt:  new Date(args.until) }

  const segs = await prisma.recordingSegment.findMany({
    where,
    select: {
      id: true, cameraId: true, storagePath: true, sizeBytes: true,
      camera: { select: { site: { select: { clienteFinal: { select: { integradorId: true } } } } } },
    },
    orderBy: { startedAt: 'asc' },
  })

  console.log(`\n=== Cleanup target ===`)
  console.log(`  cameraId: ${args.cameraId ?? '(all)'}`)
  console.log(`  since:    ${args.since ?? '(none)'}`)
  console.log(`  until:    ${args.until ?? '(none)'}`)
  console.log(`  dryRun:   ${args.dryRun}`)
  console.log(`  total:    ${segs.length} segments`)

  const totalBytes = segs.reduce((a, s) => a + Number(s.sizeBytes ?? 0), 0)
  console.log(`  size:     ${(totalBytes / (1024*1024)).toFixed(1)} MB\n`)

  if (segs.length === 0) {
    console.log('Nada pra fazer.')
    process.exit(0)
  }
  if (args.dryRun) {
    console.log('DRY-RUN — não apaga nada.')
    process.exit(0)
  }

  // Agrupa por integradorId pra batch delete no bucket multi-tenant
  const byIntegrador = new Map<string, { paths: string[]; ids: string[] }>()
  for (const s of segs) {
    const integradorId = s.camera?.site?.clienteFinal?.integradorId ?? 'default'
    if (!byIntegrador.has(integradorId)) {
      byIntegrador.set(integradorId, { paths: [], ids: [] })
    }
    const e = byIntegrador.get(integradorId)!
    e.paths.push(s.storagePath)
    e.ids.push(s.id)
  }

  let totalDeletedR2 = 0
  let totalDeletedLocal = 0
  let totalDeletedDb = 0

  for (const [integradorId, { paths, ids }] of byIntegrador) {
    console.log(`\n--- integradorId=${integradorId} (${paths.length} objetos) ---`)

    // 1. Apaga do R2/S3 (em batches de 100 — limit do API)
    if (recordingStorage.isCloudEnabled()) {
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100)
        try {
          const ok = await recordingStorage.removeMany(integradorId, batch)
          if (ok) {
            totalDeletedR2 += batch.length
            process.stdout.write(`R2 [${i + batch.length}/${paths.length}] `)
          }
        } catch (err: any) {
          console.warn(`\nremoveMany batch ${i} falhou:`, err?.message ?? err)
        }
      }
      console.log()
    }

    // 2. Apaga arquivos locais (best-effort — pode já ter sido cleanup'ado)
    for (const path of paths) {
      const local = recordingStorage.absolutePath(path)
      try {
        await fs.unlink(local)
        totalDeletedLocal++
      } catch { /* arquivo já não existe */ }
    }

    // 3. Apaga do DB (em batches)
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500)
      const r = await prisma.recordingSegment.deleteMany({ where: { id: { in: batch } } })
      totalDeletedDb += r.count
      process.stdout.write(`DB [${totalDeletedDb}/${segs.length}] `)
    }
    console.log()
  }

  console.log(`\n=== Cleanup done ===`)
  console.log(`  R2/S3 deleted:  ${totalDeletedR2}`)
  console.log(`  Local deleted:  ${totalDeletedLocal}`)
  console.log(`  DB rows deleted: ${totalDeletedDb}`)

  await prisma.$disconnect()
}

main().catch(err => { console.error('FATAL:', err); process.exit(1) })
