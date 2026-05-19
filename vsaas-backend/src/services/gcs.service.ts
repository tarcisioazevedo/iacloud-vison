/**
 * GCS Service — upload de evidências com TTL LGPD.
 * Em dev (sem credenciais GCP reais) retorna mock placeholders.
 */
import { randomUUID } from 'crypto'
import { addHours } from 'date-fns'
import { logger } from '../lib/logger'

const TTL_HOURS = Number(process.env.GCS_EVIDENCE_TTL_HOURS ?? 72)
const BUCKET    = process.env.GCS_EVIDENCE_BUCKET ?? 'iacloud-evidence-raw'
const IS_DEV    = process.env.NODE_ENV !== 'production'
const GCS_LOCATION = process.env.GCS_EVIDENCE_LOCATION ?? 'US'
const AUTO_CREATE_BUCKET = process.env.GCS_AUTO_CREATE_BUCKET === 'true'

export interface UploadResult {
  bucket:     string
  key:        string
  expiry:     Date
  signedUrl:  string
}

export class GcsService {
  private storage: any = null

  private async getStorage() {
    if (this.storage) return this.storage
    try {
      const { Storage } = await import('@google-cloud/storage')
      this.storage = new Storage()
      return this.storage
    } catch {
      return null
    }
  }

  async uploadEvidence(
    imageB64: string,
    integradorId: string,
    cameraId: string,
  ): Promise<UploadResult> {
    const now      = new Date()
    const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
    const key      = `evidence/${integradorId}/${cameraId}/${datePath}/${randomUUID()}.jpg`
    const expiry   = addHours(now, TTL_HOURS)

    const storage = await this.getStorage()
    if (!storage || IS_DEV) {
      logger.debug({ key }, 'gcs_upload_mocked')
      return {
        bucket:    BUCKET,
        key,
        expiry,
        signedUrl: `http://localhost:3000/dev/evidence/${key}`,
      }
    }

    const buffer = Buffer.from(imageB64, 'base64')
    const file   = storage.bucket(BUCKET).file(key)

    await file.save(buffer, {
      contentType: 'image/jpeg',
      metadata: {
        metadata: { integradorId, cameraId, uploadedAt: now.toISOString(), expiresAt: expiry.toISOString() },
      },
    })

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000,
    })

    logger.debug({ key, expiry }, 'evidence_uploaded')
    return { bucket: BUCKET, key, expiry, signedUrl }
  }

  async getSignedUrl(key: string, expiresInMs = 3600_000): Promise<string | null> {
    if (IS_DEV) return `http://localhost:3000/dev/evidence/${key}`
    const storage = await this.getStorage()
    if (!storage) return null
    try {
      const file = storage.bucket(BUCKET).file(key)
      const [exists] = await file.exists()
      if (!exists) return null
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + expiresInMs })
      return url
    } catch (err) {
      logger.warn({ key, err }, 'signed_url_failed')
      return null
    }
  }

  async applyLifecyclePolicy(): Promise<void> {
    const storage = await this.getStorage()
    if (!storage) { logger.warn('gcs_client_unavailable'); return }
    const bucket = storage.bucket(BUCKET)
    const [exists] = await bucket.exists().catch((err: any) => {
      if (err?.code === 404) return [false]
      throw err
    })

    if (!exists) {
      if (!AUTO_CREATE_BUCKET) {
        logger.warn({ bucket: BUCKET }, 'gcs_bucket_missing')
        return
      }
      await storage.createBucket(BUCKET, { location: GCS_LOCATION })
      logger.info({ bucket: BUCKET, location: GCS_LOCATION }, 'gcs_bucket_created')
    }

    await bucket.setMetadata({
      lifecycle: {
        rule: [{ action: { type: 'Delete' }, condition: { age: Math.ceil(TTL_HOURS / 24) } }],
      },
    })
    logger.info({ bucket: BUCKET, ttlHours: TTL_HOURS }, 'gcs_lifecycle_applied')
  }
}

export const gcsService = new GcsService()
