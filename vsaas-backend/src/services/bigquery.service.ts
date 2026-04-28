/**
 * BigQuery Service — sink de longo prazo para analytics.
 * Réplica assíncrona dos AnalyticsEvents para análise histórica.
 * Em dev (sem credenciais GCP reais) todas as operações são no-op silenciosas.
 */
import { logger } from '../lib/logger'

const PROJECT = process.env.GCP_PROJECT_ID ?? 'dev-project'
const DATASET  = process.env.BQ_DATASET_DEFAULT ?? 'iacloud_analytics'

interface BqEventRow {
  event_id:         string
  camera_id:        string
  zone_id:          string | null
  integrador_id:    string
  model:            string
  pipeline:         string
  event_type:       string
  severity:         string
  captured_at:      string
  processed_at:     string
  dwell_time_sec:   number | null
  age_range:        string | null
  gender:           string | null
  dominant_emotion: string | null
  emotion_joy:      number | null
  emotion_sorrow:   number | null
  person_count:     number | null
  has_hat:          boolean | null
  has_glasses:      boolean | null
  labels_json:      string | null
  logos_json:       string | null
  ppe_compliant:    boolean | null
  occupancy_count:  number | null
}

export class BigQueryService {
  private bq: any = null

  private async getClient() {
    if (this.bq) return this.bq
    try {
      const { BigQuery } = await import('@google-cloud/bigquery')
      this.bq = new BigQuery({ projectId: PROJECT })
      return this.bq
    } catch {
      return null
    }
  }

  async insertEvent(event: BqEventRow, _integradorId: string): Promise<string | null> {
    const bq = await this.getClient()
    if (!bq) {
      logger.debug({ eventId: event.event_id }, 'bq_skipped_no_client')
      return null
    }
    try {
      await bq.dataset(DATASET).table('analytics_events').insert([event], { skipInvalidRows: false })
      return event.event_id
    } catch (err: any) {
      logger.warn({ err: err?.message, eventId: event.event_id }, 'bq_insert_failed')
      return null
    }
  }

  async ensureTable(): Promise<void> {
    const bq = await this.getClient()
    if (!bq) { logger.warn('bq_client_unavailable'); return }
    const schema = [
      { name: 'event_id',         type: 'STRING',    mode: 'REQUIRED' },
      { name: 'camera_id',        type: 'STRING',    mode: 'REQUIRED' },
      { name: 'zone_id',          type: 'STRING',    mode: 'NULLABLE' },
      { name: 'integrador_id',    type: 'STRING',    mode: 'REQUIRED' },
      { name: 'model',            type: 'STRING',    mode: 'REQUIRED' },
      { name: 'pipeline',         type: 'STRING',    mode: 'REQUIRED' },
      { name: 'event_type',       type: 'STRING',    mode: 'REQUIRED' },
      { name: 'severity',         type: 'STRING',    mode: 'REQUIRED' },
      { name: 'captured_at',      type: 'TIMESTAMP', mode: 'REQUIRED' },
      { name: 'processed_at',     type: 'TIMESTAMP', mode: 'REQUIRED' },
      { name: 'dwell_time_sec',   type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'age_range',        type: 'STRING',    mode: 'NULLABLE' },
      { name: 'gender',           type: 'STRING',    mode: 'NULLABLE' },
      { name: 'dominant_emotion', type: 'STRING',    mode: 'NULLABLE' },
      { name: 'emotion_joy',      type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'emotion_sorrow',   type: 'FLOAT',     mode: 'NULLABLE' },
      { name: 'person_count',     type: 'INTEGER',   mode: 'NULLABLE' },
      { name: 'has_hat',          type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'has_glasses',      type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'labels_json',      type: 'STRING',    mode: 'NULLABLE' },
      { name: 'logos_json',       type: 'STRING',    mode: 'NULLABLE' },
      { name: 'ppe_compliant',    type: 'BOOLEAN',   mode: 'NULLABLE' },
      { name: 'occupancy_count',  type: 'INTEGER',   mode: 'NULLABLE' },
    ]
    try {
      await bq.dataset(DATASET).createTable('analytics_events', {
        schema,
        timePartitioning: { type: 'DAY', field: 'captured_at' },
      })
      logger.info('bq_table_created')
    } catch (err: any) {
      if (err?.code !== 409) throw err
    }
  }
}

export const bigQueryService = new BigQueryService()
