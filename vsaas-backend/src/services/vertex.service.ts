/**
 * Vertex AI Vision Service
 *
 * Provisionamento de Streams e Applications para o Pipeline 2.
 * Usa a API REST do Vertex AI Vision (visionai.googleapis.com).
 *
 * Referência: https://cloud.google.com/vision-ai/docs/reference/rest
 */
import { GoogleAuth } from 'google-auth-library'
import { logger } from '../lib/logger'

const PROJECT  = process.env.GCP_PROJECT_ID!
const LOCATION = process.env.VERTEX_VISION_LOCATION ?? 'us-central1'
const BASE_URL = `https://visionai.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}`

export interface VertexProvisionResult {
  streamId: string        // resource name completo
  appId: string
  bqDatasetId: string
  bqTableId: string
}

export class VertexVisionService {
  private auth: GoogleAuth

  constructor() {
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }

  private async _request(
    method: string,
    path: string,
    body?: object,
  ): Promise<any> {
    const client  = await this.auth.getClient()
    const headers = await (client as any).getRequestHeaders()
    const url     = `${BASE_URL}/${path}`

    const resp = await fetch(url, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Vertex API ${resp.status}: ${text.slice(0, 300)}`)
    }
    return resp.json()
  }

  /** Cria Stream de ingestão para a câmera. */
  async createStream(streamId: string): Promise<string> {
    const resp = await this._request('POST', `streams?streamId=${streamId}`, {
      displayName: `ICV Stream ${streamId}`,
    })
    logger.info({ streamId, operation: resp.name }, 'vertex_stream_created')
    return resp.name as string
  }

  /** Cria Application Graph com nós pré-configurados. */
  async createApplication(
    appId: string,
    streamResourceName: string,
    models: ('OCCUPANCY_ANALYTICS' | 'PPE_DETECTION')[],
    bqDataset: string,
    bqTable: string,
  ): Promise<string> {
    const processors = models.map(m => ({
      processor: m === 'OCCUPANCY_ANALYTICS'
        ? 'builtin:OccupancyCountProcessor'
        : 'builtin:PersonalProtectiveEquipmentProcessor',
      name: m.toLowerCase(),
    }))

    const body = {
      displayName: `ICV App ${appId}`,
      nodes: [
        // Nó de entrada: stream
        {
          name: 'input-stream',
          processor: 'builtin:StreamProcessor',
          outputAllOutputChannels: true,
        },
        // Nós de processamento
        ...processors.map(p => ({
          name: p.name,
          processor: p.processor,
          parents: [{ parentNode: 'input-stream' }],
          outputAllOutputChannels: true,
        })),
        // Sink: BigQuery
        {
          name: 'bq-sink',
          processor: 'builtin:BigQueryProcessor',
          processorConfig: {
            bigQueryConfig: {
              table: `${PROJECT}:${bqDataset}.${bqTable}`,
              createDefaultTableIfNotExists: true,
            },
          },
          parents: processors.map(p => ({ parentNode: p.name })),
        },
      ],
    }

    const resp = await this._request('POST', `applications?applicationId=${appId}`, body)
    logger.info({ appId, operation: resp.name }, 'vertex_app_created')
    return resp.name as string
  }

  /** Deploy da application (ativa o processamento contínuo). */
  async deployApplication(appResourceName: string): Promise<void> {
    const appId = appResourceName.split('/').pop()
    await this._request('POST', `applications/${appId}:deploy`, {})
    logger.info({ appResourceName }, 'vertex_app_deployed')
  }

  /** Undeploy (parar stream — usado quando quota esgotada). */
  async undeployApplication(appId: string): Promise<void> {
    await this._request('POST', `applications/${appId}:undeploy`, {})
    logger.info({ appId }, 'vertex_app_undeployed')
  }

  /** Provisionamento completo de uma câmera Pipeline 2. */
  async provisionCamera(
    cameraId: string,
    integradorId: string,
    models: ('OCCUPANCY_ANALYTICS' | 'PPE_DETECTION')[],
  ): Promise<VertexProvisionResult> {
    const streamId   = `icv-${integradorId.slice(0, 8)}-${cameraId.slice(0, 8)}`
    const appId      = `icv-app-${cameraId.slice(0, 8)}`
    const bqDataset  = `icv_${integradorId.replace(/-/g, '_').slice(0, 20)}`
    const bqTable    = `events_${cameraId.replace(/-/g, '_').slice(0, 20)}`

    const streamResource = await this.createStream(streamId)
    void await this.createApplication(appId, streamResource, models, bqDataset, bqTable)
    await this.deployApplication(appId)

    return {
      streamId: streamResource,
      appId,
      bqDatasetId: bqDataset,
      bqTableId:   bqTable,
    }
  }
}

export const vertexService = new VertexVisionService()
