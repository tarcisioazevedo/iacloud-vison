import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { logger } from '../lib/logger'

const S3_ENDPOINT = process.env.ICV_S3_ENDPOINT || 'https://fsn1.your-objectstorage.com'
const S3_ACCESS_KEY = process.env.ICV_S3_ACCESS_KEY || ''
const S3_SECRET_KEY = process.env.ICV_S3_SECRET_KEY || ''
const S3_BUCKET = process.env.ICV_S3_BUCKET || 'icv-iacloud-vision'
const S3_REGION = process.env.ICV_S3_REGION || 'fsn1'

let s3Client: S3Client | null = null

if (S3_ACCESS_KEY && S3_SECRET_KEY) {
  s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
    forcePathStyle: true,
  })
}

export const s3Service = {
  /**
   * Faz upload do snapshot (base64) para o bucket S3 e retorna as chaves de evidência.
   */
  async uploadSnapshotBase64(
    base64Data: string,
    integradorId: string,
    clienteFinalId: string,
    edgeNodeId: string,
    eventId: string
  ): Promise<{ bucket: string; key: string } | null> {
    if (!s3Client) {
      logger.debug('S3 não configurado, pulando upload de evidência.')
      return null
    }

    try {
      // Remove o prefixo "data:image/webp;base64," se existir
      const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '')
      const buffer = Buffer.from(base64Clean, 'base64')

      const dateStr = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const s3Key = `events/${integradorId}/${clienteFinalId}/${edgeNodeId}/${dateStr}/${eventId}.webp`

      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: buffer,
          ContentType: 'image/webp',
          // Descomente se o bucket for público e você quiser permitir leitura anônima
          // ACL: 'public-read',
        })
      )

      return {
        bucket: S3_BUCKET,
        key: s3Key,
      }
    } catch (err: any) {
      logger.error({ err: err.message, eventId }, 's3_upload_failed')
      return null
    }
  },
}
