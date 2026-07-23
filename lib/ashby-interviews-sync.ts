// Ashby interview-events → Supabase sync (server-only).
//
// Ashby's interviewSchedule.list is oldest-first with no date filter and is slow to paginate,
// so counting "recruiter screens this week" live is infeasible. Instead we sync completed
// interview events into `ashby_interviews` and query that. Two modes, mirroring the MeetAlfred
// sync:
//   - 'backfill'    : full pagination from the start (run once, locally). Captures a syncToken.
//   - 'incremental' : pass the stored syncToken so Ashby returns only changed schedules.
//
// Idempotent: rows are upserted by the Ashby interviewEvent id.

import { supabase } from './supabase'
import {
  ashbyConfigured,
  ashbyPost,
  getStageMap,
  getInterviewTitleMap,
  getApplicationCandidateMap,
  type RawInterviewSchedule,
} from './ashby'

export type InterviewSyncMode = 'backfill' | 'incremental'

export interface InterviewSyncSummary {
  mode: InterviewSyncMode
  schedulesScanned: number
  eventsUpserted: number
  pages: number
  hadSyncToken: boolean
  gotSyncToken: boolean
  elapsedMs: number
}

interface InterviewEventRow {
  event_id: string
  schedule_id: string
  application_id: string | null
  candidate_id: string | null
  stage_id: string | null
  stage_title: string | null
  stage_order: number | null
  interview_id: string | null
  interview_title: string | null
  start_time: string
  status: string | null
  raw: unknown
}

interface ScheduleEnvelope {
  results?: RawInterviewSchedule[]
  moreDataAvailable?: boolean
  nextCursor?: string
  syncToken?: string
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function upsertEvents(rows: InterviewEventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const seen = new Map<string, InterviewEventRow>()
  for (const r of rows) seen.set(r.event_id, r)
  const deduped = [...seen.values()]
  let n = 0
  for (const c of chunk(deduped, 500)) {
    const { error } = await supabase.from('ashby_interviews').upsert(c, { onConflict: 'event_id' })
    if (error) throw new Error(`ashby_interviews upsert failed: ${error.message}`)
    n += c.length
  }
  return n
}

async function readSyncToken(): Promise<string | null> {
  const { data, error } = await supabase
    .from('site_state')
    .select('ashby_interview_sync_token')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`site_state read failed: ${error.message}`)
  return data?.ashby_interview_sync_token ?? null
}

export async function syncAshbyInterviews(mode: InterviewSyncMode): Promise<InterviewSyncSummary> {
  const startedAtMs = Date.now()
  if (!ashbyConfigured()) throw new Error('ASHBY_API_KEY not set')

  const token = mode === 'incremental' ? await readSyncToken() : null

  // Resolve stage (title + order) / interview titles / application→candidate once; used to tag
  // every event row.
  const [stageMap, interviewMap, candidateMap] = await Promise.all([
    getStageMap(), getInterviewTitleMap(), getApplicationCandidateMap(),
  ])

  const maxPages = mode === 'backfill' ? 1000 : 200
  let cursor: string | undefined
  let firstRequest = true
  let pages = 0
  let schedulesScanned = 0
  let eventsUpserted = 0
  let gotSyncToken: string | null = null

  while (pages < maxPages) {
    const body: Record<string, unknown> = { limit: 100 }
    if (cursor) body.cursor = cursor
    else if (firstRequest && token) body.syncToken = token
    firstRequest = false

    const env = (await ashbyPost<RawInterviewSchedule[]>('interviewSchedule.list', body)) as ScheduleEnvelope
    const results = env.results ?? []
    schedulesScanned += results.length
    pages += 1

    const rows: InterviewEventRow[] = []
    for (const sched of results) {
      if (sched.status !== 'Complete') continue
      for (const e of sched.interviewEvents ?? []) {
        if (!e.id || !e.startTime) continue
        const t = Date.parse(e.startTime)
        if (isNaN(t)) continue
        const stageInfo = sched.interviewStageId ? stageMap.get(sched.interviewStageId) : undefined
        rows.push({
          event_id: e.id,
          schedule_id: sched.id,
          application_id: sched.applicationId ?? null,
          candidate_id: sched.applicationId ? candidateMap.get(sched.applicationId) ?? null : null,
          stage_id: sched.interviewStageId ?? null,
          stage_title: stageInfo?.title ?? null,
          stage_order: stageInfo?.order ?? null,
          interview_id: e.interviewId ?? null,
          interview_title: e.interviewId ? interviewMap.get(e.interviewId) ?? null : null,
          start_time: new Date(t).toISOString(),
          status: sched.status ?? null,
          raw: e,
        })
      }
    }
    eventsUpserted += await upsertEvents(rows)

    if (env.syncToken) gotSyncToken = env.syncToken // emitted on the final page
    if (!env.moreDataAvailable || !env.nextCursor) break
    cursor = env.nextCursor
  }

  // Store the fresh syncToken so the next incremental run only pulls changes.
  if (gotSyncToken) {
    const { error } = await supabase
      .from('site_state')
      .update({ ashby_interview_sync_token: gotSyncToken })
      .eq('id', 1)
    if (error) throw new Error(`site_state syncToken update failed: ${error.message}`)
  }

  return {
    mode,
    schedulesScanned,
    eventsUpserted,
    pages,
    hadSyncToken: !!token,
    gotSyncToken: !!gotSyncToken,
    elapsedMs: Date.now() - startedAtMs,
  }
}
