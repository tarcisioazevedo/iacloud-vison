// Wipe-R2 — apaga todos os objetos dos buckets do prefixo icv-* e do icv-default.
// Uso: docker exec <backend> node /app/scripts/wipe-r2.mjs
// Apaga objetos em batch de 1000. Mantém o bucket vazio (não deleta o bucket).
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'

const endpoint = process.env.R2_ENDPOINT
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const prefix = process.env.R2_BUCKET_PREFIX ?? 'icv'

if (!endpoint || !accessKeyId || !secretAccessKey) {
  console.error('R2 credentials missing')
  process.exit(1)
}

const s3 = new S3Client({
  endpoint, region: 'auto',
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
})

const list = await s3.send(new ListBucketsCommand({}))
const targetBuckets = (list.Buckets ?? [])
  .map(b => b.Name)
  .filter(name => name && (name.startsWith(`${prefix}-`) || name === `${prefix}-default`))

console.log(`Found ${targetBuckets.length} bucket(s) to wipe:`, targetBuckets)

let totalDeleted = 0
let totalBytes = 0

for (const bucket of targetBuckets) {
  let deleted = 0
  let bytes = 0
  let token = undefined
  do {
    const lst = await s3.send(new ListObjectsV2Command({
      Bucket: bucket, MaxKeys: 1000, ContinuationToken: token,
    }))
    const objs = lst.Contents ?? []
    if (objs.length > 0) {
      bytes += objs.reduce((s, o) => s + (o.Size ?? 0), 0)
      const r = await s3.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objs.map(o => ({ Key: o.Key })), Quiet: true },
      }))
      deleted += objs.length - (r.Errors?.length ?? 0)
      if (r.Errors?.length) {
        console.warn(`[${bucket}] ${r.Errors.length} delete errors:`, r.Errors.slice(0, 3))
      }
    }
    token = lst.NextContinuationToken
  } while (token)
  console.log(`[${bucket}] deleted=${deleted} bytes=${bytes}`)
  totalDeleted += deleted
  totalBytes += bytes
}

console.log(`---\nDONE: ${totalDeleted} objects, ${(totalBytes / 1024 / 1024).toFixed(2)} MB across ${targetBuckets.length} buckets.`)
