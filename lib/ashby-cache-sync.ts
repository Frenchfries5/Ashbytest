// Ashby → Supabase cache sync (server-only).
//
// The dashboard reads jobs/applications from Supabase instead of calling Ashby on every page
// load. Two modes:
//   - 'backfill'    : full pagination of every application (~3.5k rows / ~96s). Run once, locally
//                     — it exceeds Vercel's function timeout. Captures a syncToken at the end.
//   - 'incremental' : pass the stored syncToken so Ashby returns only changed rows (~1s). This is
//                     what the daily cron and the on-load revalidate use.
//
// Idempotent: rows are upserted by Ashby id. If a syncToken is rejected (expired/invalid), the
// sync transparently falls back to a full pass so the cache can never get permanently stuck.

import { supabase } from './supabase'
import {
  ashbyConfigured,
  ashbyPost,
  ashbyPaginate,
  idNameMap,
  type RawApplication,
  type RawJob,
} from './ashby'

export type CacheSyncMode = 'backfill' | 'incremental'

export interface CacheSyncSummary {
  mode: CacheSyncMode
  jobs: number
  applications: number
  pages: number
  usedSyncToken: boolean
  tokenRejected: boolean
  elapsedMs: number
  syncedAt: string
}

interface AppEnvelope {
  results?: RawApplication[]
  moreDataAvailable?: boolean
  nextCursor?: string
  syncToken?: string
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function iso(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const t = Date.parse(s)
  return isNaN(t) ? null : new Date(t).toISOString()
}

function normalizeSource(s: RawApplication['source']): string | null {
  if (!s) return null
  if (typeof s === 'string') return str(s)
  return str(s.title) ?? str(s.sourceType?.title)
}

function normalizeArchiveReason(r: RawApplication['archiveReason']): string | null {
  if (!r) return null
  if (typeof r === 'string') return str(r)
  return str(r.text) ?? str(r.title)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── row mappers (DB column shapes) ──────────────────────────────────────────────
function appRow(a: RawApplication) {
  const stage = a.currentInterviewStage
  return {
    id: a.id,
    job_id: str(a.job?.id),
    candidate_id: str(a.candidate?.id),
    candidate_name: str(a.candidate?.name),
    status: str(a.status),
    stage_title: str(stage?.title),
    stage_type: str(stage?.type),
    stage_order: typeof stage?.orderInInterviewPlan === 'number' ? stage.orderInInterviewPlan : null,
    source: normalizeSource(a.source),
    owner: str([a.creditedToUser?.firstName, a.creditedToUser?.lastName].filter(Boolean).join(' ')),
    archive_reason: normalizeArchiveReason(a.archiveReason),
    created_at: iso(a.createdAt),
    updated_at: iso(a.updatedAt),
    raw: a,
  }
}

function jobRow(j: RawJob, depts: Map<string, string>, locs: Map<string, string>) {
  let recruiter: string | null = null
  if (Array.isArray(j.hiringTeam) && j.hiringTeam.length) {
    const pick = j.hiringTeam.find((m) => /recruit/i.test(m.role ?? '')) ?? j.hiringTeam[0]
    recruiter = str([pick?.firstName, pick?.lastName].filter(Boolean).join(' '))
  }
  return {
    id: j.id,
    title: str(j.title) ?? 'Untitled role',
    status: str(j.status),
    department: (j.departmentId && depts.get(j.departmentId)) || null,
    location: (j.locationId && locs.get(j.locationId)) || null,
    employment_type: str(j.employmentType)?.replace(/([a-z])([A-Z])/g, '$1 $2') ?? null,
    opened_at: iso(j.openedAt) ?? iso(j.createdAt),
    openings: Array.isArray(j.openings) ? j.openings.length : null,
    recruiter,
    raw: j,
  }
}

// ── upserts ─────────────────────────────────────────────────────────────────────
async function upsertApplications(rows: ReturnType<typeof appRow>[]): Promise<number> {
  if (!rows.length) return 0
  const seen = new Map<string, ReturnType<typeof appRow>>()
  for (const r of rows) seen.set(r.id, r)
  let n = 0
  for (const c of chunk([...seen.values()], 500)) {
    const { error } = await supabase.from('ashby_applications').upsert(c, { onConflict: 'id' })
    if (error) throw new Error(`ashby_applications upsert failed: ${error.message}`)
    n += c.length
  }
  return n
}

interface JobEnvelope {
  results?: RawJob[]
  moreDataAvailable?: boolean
  nextCursor?: string
  syncToken?: string
}

// Jobs, incremental via syncToken like applications. Department/location arrive as ids and are
// resolved to names — but only when there are actually changed jobs, so a no-op incremental sync
// costs one request instead of four.
async function syncJobs(token: string | null): Promise<{ count: number; token: string | null }> {
  const raw: RawJob[] = []
  let freshToken: string | null = null

  async function pull(body: Record<string, unknown>) {
    let cursor: string | undefined
    let first = true
    for (let page = 0; page < 50; page++) {
      const b: Record<string, unknown> = { ...body, limit: 100, expand: ['openings'] }
      if (cursor) b.cursor = cursor
      else if (first && token) b.syncToken = token
      first = false
      const env = (await ashbyPost<RawJob[]>('job.list', b)) as JobEnvelope
      raw.push(...(env.results ?? []))
      if (env.syncToken) freshToken = env.syncToken
      if (!env.moreDataAvailable || !env.nextCursor) break
      cursor = env.nextCursor
    }
  }

  if (token) {
    // A syncToken already spans every status — one pass covers open and closed changes.
    await pull({})
  } else {
    await pull({ status: ['Open'] })
    await pull({ status: ['Closed', 'Archived'] })
  }

  const jobs = raw.filter((j) => j?.id)
  if (!jobs.length) return { count: 0, token: freshToken }

  const [depts, locs] = await Promise.all([idNameMap('department.list'), idNameMap('location.list')])
  const rows = jobs.map((j) => jobRow(j, depts, locs))
  for (const c of chunk(rows, 500)) {
    const { error } = await supabase.from('ashby_jobs').upsert(c, { onConflict: 'id' })
    if (error) throw new Error(`ashby_jobs upsert failed: ${error.message}`)
  }
  return { count: rows.length, token: freshToken }
}

async function readTokens(): Promise<{ app: string | null; job: string | null }> {
  const { data, error } = await supabase
    .from('site_state')
    .select('ashby_app_sync_token, ashby_job_sync_token')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`site_state read failed: ${error.message}`)
  return { app: data?.ashby_app_sync_token ?? null, job: data?.ashby_job_sync_token ?? null }
}

// Page applications, either from scratch or from a syncToken. Returns the rows written, the page
// count, and the fresh token (emitted on the final page).
async function syncApplications(token: string | null): Promise<{ count: number; pages: number; token: string | null }> {
  let cursor: string | undefined
  let first = true
  let pages = 0
  let count = 0
  let freshToken: string | null = null
  const MAX_PAGES = 200

  while (pages < MAX_PAGES) {
    const body: Record<string, unknown> = { limit: 100 }
    if (cursor) body.cursor = cursor
    else if (first && token) body.syncToken = token
    first = false

    const env = (await ashbyPost<RawApplication[]>('application.list', body)) as AppEnvelope
    const results = env.results ?? []
    pages += 1
    count += await upsertApplications(results.filter((a) => a?.id).map(appRow))

    if (env.syncToken) freshToken = env.syncToken
    if (!env.moreDataAvailable || !env.nextCursor) break
    cursor = env.nextCursor
  }
  return { count, pages, token: freshToken }
}

export async function syncAshbyCache(mode: CacheSyncMode): Promise<CacheSyncSummary> {
  const startedAt = Date.now()
  if (!ashbyConfigured()) throw new Error('ASHBY_API_KEY not set')

  const tokens = mode === 'incremental' ? await readTokens() : { app: null, job: null }

  let tokenRejected = false
  // An expired/invalid token must never wedge the cache — retry that stream from scratch.
  const retryOnBadToken = async <T>(had: string | null, run: (t: string | null) => Promise<T>): Promise<T> => {
    try {
      return await run(had)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (had && /sync_token/i.test(msg)) {
        tokenRejected = true
        return await run(null)
      }
      throw err
    }
  }

  const jobs = await retryOnBadToken(tokens.job, syncJobs)
  const apps = await retryOnBadToken(tokens.app, syncApplications)

  const syncedAt = new Date().toISOString()
  const patch: Record<string, unknown> = { ashby_synced_at: syncedAt }
  if (apps.token) patch.ashby_app_sync_token = apps.token
  if (jobs.token) patch.ashby_job_sync_token = jobs.token
  const { error } = await supabase.from('site_state').update(patch).eq('id', 1)
  if (error) throw new Error(`site_state sync bookkeeping failed: ${error.message}`)

  return {
    mode,
    jobs: jobs.count,
    applications: apps.count,
    pages: apps.pages,
    usedSyncToken: !!tokens.app && !tokenRejected,
    tokenRejected,
    elapsedMs: Date.now() - startedAt,
    syncedAt,
  }
}

// Last successful sync time (drives the "last synced" label and the revalidate throttle).
export async function getCacheSyncedAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from('site_state')
    .select('ashby_synced_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) return null
  return data?.ashby_synced_at ?? null
}
