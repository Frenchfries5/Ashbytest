import { supabase } from './supabase'
import { queryApplications } from './ashby-cache'
import { DAY, weekStartUTC } from './week'

// What actually happened on a req during one week — named, not aggregated. Built for the Friday
// email: aggregate rates answer "how are we doing", but a weekly read wants "who moved, to what,
// when, and how did they score".
//
// "Movement" = a completed interview at a stage past the initial screen. Interview events are the
// only reliable per-candidate signal: an application's stage decays to "Archived" once a candidate
// is rejected, so stage-based movement would silently lose people mid-week.

const DEFAULT_REQ = /broker.*growth/i
const ROLE_REQ: Record<string, RegExp> = {
  growth: /broker.*growth/i,
  core: /broker.*core/i,
  am: /account manager/i,
}
const EARLY_STAGE = /new lead|reached out|replied|application review|holding tank|recruiter screen|introduction call|sourced/i
const SCREEN_STAGE = /recruiter screen|introduction call/i

export interface WeeklyDigest {
  configured: boolean
  role: string
  reqs: string[]
  weekStart: string
  weekEnd: string
  newApplications: number
  screened: { name: string; at: string }[]
  movements: { name: string; stage: string; at: string; source: string | null }[]
  ratings: { average: number | null; count: number; distribution: Record<string, number> }
}

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999)
    if (error) return out
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

export async function getWeeklyDigest(opts: { role?: string; week?: 'current' | 'last' } = {}): Promise<WeeklyDigest> {
  const role = (opts.role ?? 'growth').toLowerCase()
  const matcher = ROLE_REQ[role] ?? DEFAULT_REQ

  // The Friday send reports the week it's closing out, so 'current' is the default.
  const thisMonday = weekStartUTC(Date.now())
  const start = opts.week === 'last' ? thisMonday - 7 * DAY : thisMonday
  const end = start + 7 * DAY

  const empty: WeeklyDigest = {
    configured: false, role, reqs: [],
    weekStart: new Date(start).toISOString(), weekEnd: new Date(end - 1).toISOString(),
    newApplications: 0, screened: [], movements: [],
    ratings: { average: null, count: 0, distribution: { '1': 0, '2': 0, '3': 0, '4': 0 } },
  }

  const [{ data: jobRows }, appRows] = await Promise.all([
    supabase.from('ashby_jobs').select('id, title'),
    queryApplications(),
  ])
  if (!appRows) return empty

  const reqs = (jobRows ?? []).filter(
    (j) => typeof j.title === 'string' && matcher.test(j.title) && !/\btest\b/i.test(j.title)
  ) as { id: string; title: string }[]
  if (!reqs.length) return empty

  const reqIds = new Set(reqs.map((r) => r.id))
  const apps = appRows.filter((a) => a.job_id && reqIds.has(a.job_id))
  const appById = new Map(apps.map((a) => [a.id, a]))

  const events = await selectAll<{ application_id: string | null; stage_title: string | null; start_time: string }>(
    'ashby_interviews', 'application_id, stage_title, start_time'
  )

  const movements: WeeklyDigest['movements'] = []
  const screened: WeeklyDigest['screened'] = []
  const seenMove = new Set<string>()
  for (const e of events) {
    if (!e.application_id || !e.stage_title || !e.start_time) continue
    const a = appById.get(e.application_id)
    if (!a) continue
    const t = Date.parse(e.start_time)
    if (isNaN(t) || t < start || t >= end) continue
    const name = a.candidate_name ?? 'Unnamed candidate'
    if (SCREEN_STAGE.test(e.stage_title)) {
      screened.push({ name, at: new Date(t).toISOString() })
    } else if (!EARLY_STAGE.test(e.stage_title)) {
      // One row per candidate+stage, so a rescheduled round isn't listed twice.
      const k = `${e.application_id}|${e.stage_title}`
      if (seenMove.has(k)) continue
      seenMove.add(k)
      movements.push({ name, stage: e.stage_title, at: new Date(t).toISOString(), source: a.source })
    }
  }
  movements.sort((x, y) => x.at.localeCompare(y.at))
  screened.sort((x, y) => x.at.localeCompare(y.at))

  // Scorecards submitted during the week, for this req's applications.
  const feedback = await selectAll<{ application_id: string | null; overall_recommendation: number | null; submitted_at: string | null }>(
    'ashby_feedback', 'application_id, overall_recommendation, submitted_at'
  )
  const scores: number[] = []
  const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 }
  for (const f of feedback) {
    if (!f.application_id || !appById.has(f.application_id)) continue
    if (f.overall_recommendation == null || !f.submitted_at) continue
    const t = Date.parse(f.submitted_at)
    if (isNaN(t) || t < start || t >= end) continue
    scores.push(f.overall_recommendation)
    distribution[String(f.overall_recommendation)] = (distribution[String(f.overall_recommendation)] ?? 0) + 1
  }

  const newApplications = apps.filter((a) => {
    if (!a.created_at) return false
    const t = Date.parse(a.created_at)
    return !isNaN(t) && t >= start && t < end
  }).length

  return {
    configured: true,
    role,
    reqs: reqs.map((r) => r.title),
    weekStart: new Date(start).toISOString(),
    weekEnd: new Date(end - 1).toISOString(),
    newApplications,
    screened,
    movements,
    ratings: {
      average: scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      count: scores.length,
      distribution,
    },
  }
}
