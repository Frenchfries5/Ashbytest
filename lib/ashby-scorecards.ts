import { supabase } from './supabase'
import { loadScorecards, dedupeScorecards } from './ashby-feedback'

// Scorecard analytics: what the 1-4 overall recommendations actually tell us, read against the
// outcome each candidate ended up with.
//
// Two things make a naive read of this data misleading, and both are handled here:
//
//  1. Stage confounds interviewer averages. A recruiter screening every applicant sees a far worse
//     population than a hiring manager seeing only the survivors — Recruiter Screen averages ~2.4
//     against ~3.0 for Leadership Interview. Comparing raw interviewer averages would read as
//     "harsh vs lenient" when it's really "early vs late". Each interviewer therefore also gets
//     `vsStage`: their mean deviation from the average of the same stages they worked.
//  2. A candidate carries several scorecards. Anything per-candidate (outcome splits, score bands)
//     uses the mean of that application's scores, so a panel of four doesn't outvote a single
//     screen four times over.
//
// Row de-duplication and interviewer attribution (a scorecard belongs to whoever it is credited
// to, not whoever typed it) both happen in lib/ashby-feedback.ts.

const SCALE = [1, 2, 3, 4] as const

export interface StageStat {
  stage: string
  n: number
  avg: number
  dist: Record<string, number>
}

export interface InterviewerStat {
  name: string
  n: number
  avg: number
  vsStage: number | null // mean deviation from the stages they worked; null when none resolved
  dist: Record<string, number>
  topStage: string | null
}

// Candidates grouped by their rounded average score, with what became of them. This is the read
// that says whether the scorecard predicts anything.
export interface BandStat {
  band: number
  apps: number
  hired: number
  archived: number
  active: number
  hireRate: number | null // of decided (hired + archived) applications
}

// Every scorecard a hired candidate collected, so the aggregate above can be opened up and read
// person by person — who interviewed them, at what stage, and what they gave.
export interface HireDetail {
  applicationId: string
  name: string
  role: string | null
  hiredAt: string | null // approximated by the application's last transition
  avg: number
  count: number
  low: number
  high: number
  scores: { score: number; stage: string | null; interviewer: string; at: string | null }[]
}

export interface ScorecardAnalytics {
  configured: boolean
  jobId: string | null
  totals: {
    scorecards: number
    applications: number
    interviewers: number
    avgHired: number | null
    avgArchived: number | null
    hiredCount: number
    archivedCount: number
    unresolvedStage: number // scorecards whose interview event we couldn't match to a stage
  }
  bands: BandStat[]
  stages: StageStat[]
  interviewers: InterviewerStat[]
  hires: HireDetail[]
  roles: { id: string; title: string; n: number }[]
}

const emptyDist = (): Record<string, number> => ({ '1': 0, '2': 0, '3': 0, '4': 0 })
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

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

interface AppRow { id: string; job_id: string | null; status: string | null; candidate_name: string | null; updated_at: string | null }
interface EventRow { event_id: string; stage_title: string | null }

export async function getScorecardAnalytics(opts: { jobId?: string | null } = {}): Promise<ScorecardAnalytics> {
  const jobId = opts.jobId ?? null

  const empty: ScorecardAnalytics = {
    configured: false, jobId,
    totals: { scorecards: 0, applications: 0, interviewers: 0, avgHired: null, avgArchived: null, hiredCount: 0, archivedCount: 0, unresolvedStage: 0 },
    bands: [], stages: [], interviewers: [], hires: [], roles: [],
  }

  const [feedback, apps, events, jobRows] = await Promise.all([
    loadScorecards().then(dedupeScorecards),
    selectAll<AppRow>('ashby_applications', 'id, job_id, status, candidate_name, updated_at'),
    selectAll<EventRow>('ashby_interviews', 'event_id, stage_title'),
    selectAll<{ id: string; title: string | null }>('ashby_jobs', 'id, title'),
  ])
  if (!feedback.length || !apps.length) return empty

  const appById = new Map(apps.map((a) => [a.id, a]))
  const stageByEvent = new Map(events.map((e) => [e.event_id, e.stage_title]))
  const titleByJob = new Map(jobRows.map((j) => [j.id, j.title ?? 'Untitled role']))

  // Role list for the filter — every job with at least one scorecard, most-scored first. Built
  // before the job filter is applied so switching roles never empties the picker.
  const roleCount = new Map<string, number>()
  for (const f of feedback) {
    const a = appById.get(f.applicationId)
    if (a?.job_id) roleCount.set(a.job_id, (roleCount.get(a.job_id) ?? 0) + 1)
  }
  const roles = [...roleCount.entries()]
    .map(([id, n]) => ({ id, title: titleByJob.get(id) ?? 'Untitled role', n }))
    .filter((r) => !/\btest\b/i.test(r.title))
    .sort((a, b) => b.n - a.n)

  const scored = feedback.filter((f) => {
    const a = appById.get(f.applicationId)
    if (!a) return false
    return !jobId || a.job_id === jobId
  })
  if (!scored.length) return { ...empty, configured: true, roles }

  // ── by stage ──────────────────────────────────────────────────────────────────
  const stageScores = new Map<string, number[]>()
  const stageDist = new Map<string, Record<string, number>>()
  let unresolvedStage = 0
  for (const f of scored) {
    const stage = (f.eventId && stageByEvent.get(f.eventId)) || null
    if (!stage) { unresolvedStage++; continue }
    const n = f.score
    if (!stageScores.has(stage)) { stageScores.set(stage, []); stageDist.set(stage, emptyDist()) }
    stageScores.get(stage)!.push(n)
    stageDist.get(stage)![String(n)] += 1
  }
  const stageAvg = new Map<string, number>()
  const stages: StageStat[] = [...stageScores.entries()]
    .map(([stage, xs]) => {
      const avg = mean(xs) as number
      stageAvg.set(stage, avg)
      return { stage, n: xs.length, avg, dist: stageDist.get(stage)! }
    })
    .sort((a, b) => b.n - a.n)

  // ── by interviewer ────────────────────────────────────────────────────────────
  interface Acc { scores: number[]; dist: Record<string, number>; devs: number[]; stages: Map<string, number> }
  const byPerson = new Map<string, Acc>()
  for (const f of scored) {
    const name = f.interviewer
    const n = f.score
    if (!byPerson.has(name)) byPerson.set(name, { scores: [], dist: emptyDist(), devs: [], stages: new Map() })
    const acc = byPerson.get(name)!
    acc.scores.push(n)
    acc.dist[String(n)] += 1
    const stage = (f.eventId && stageByEvent.get(f.eventId)) || null
    if (stage) {
      acc.stages.set(stage, (acc.stages.get(stage) ?? 0) + 1)
      const base = stageAvg.get(stage)
      if (base != null) acc.devs.push(n - base)
    }
  }
  const interviewers: InterviewerStat[] = [...byPerson.entries()]
    .map(([name, acc]) => ({
      name,
      n: acc.scores.length,
      avg: mean(acc.scores) as number,
      vsStage: acc.devs.length ? (mean(acc.devs) as number) : null,
      dist: acc.dist,
      topStage: [...acc.stages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.n - a.n)

  // ── per-application: outcome splits and score bands ───────────────────────────
  const perApp = new Map<string, number[]>()
  const cardsByApp = new Map<string, HireDetail['scores']>()
  for (const f of scored) {
    const id = f.applicationId
    if (!perApp.has(id)) { perApp.set(id, []); cardsByApp.set(id, []) }
    perApp.get(id)!.push(f.score)
    cardsByApp.get(id)!.push({
      score: f.score,
      stage: (f.eventId && stageByEvent.get(f.eventId)) || null,
      interviewer: f.interviewer,
      at: f.submittedAt,
    })
  }

  const hiredAvgs: number[] = []
  const archivedAvgs: number[] = []
  const hires: HireDetail[] = []
  const bandAcc = new Map<number, { hired: number; archived: number; active: number }>()
  for (const b of SCALE) bandAcc.set(b, { hired: 0, archived: 0, active: 0 })

  for (const [id, xs] of perApp) {
    const a = appById.get(id)
    if (!a) continue
    const avg = mean(xs) as number
    if (a.status === 'Hired') {
      hiredAvgs.push(avg)
      const cards = (cardsByApp.get(id) ?? []).slice().sort((x, y) => (x.at ?? '').localeCompare(y.at ?? ''))
      hires.push({
        applicationId: id,
        name: a.candidate_name ?? 'Unnamed candidate',
        role: a.job_id ? titleByJob.get(a.job_id) ?? null : null,
        hiredAt: a.updated_at,
        avg, count: xs.length, low: Math.min(...xs), high: Math.max(...xs),
        scores: cards,
      })
    } else if (a.status === 'Archived') archivedAvgs.push(avg)

    // Bands round to the nearest whole point, so a 3.5 average sits with the 4s.
    const band = Math.min(4, Math.max(1, Math.round(avg)))
    const acc = bandAcc.get(band)!
    if (a.status === 'Hired') acc.hired++
    else if (a.status === 'Archived') acc.archived++
    else acc.active++
  }

  const bands: BandStat[] = SCALE.map((band) => {
    const acc = bandAcc.get(band)!
    const decided = acc.hired + acc.archived
    return {
      band,
      apps: acc.hired + acc.archived + acc.active,
      hired: acc.hired,
      archived: acc.archived,
      active: acc.active,
      hireRate: decided ? (acc.hired / decided) * 100 : null,
    }
  })

  return {
    configured: true,
    jobId,
    totals: {
      scorecards: scored.length,
      applications: perApp.size,
      interviewers: byPerson.size,
      avgHired: mean(hiredAvgs),
      avgArchived: mean(archivedAvgs),
      hiredCount: hiredAvgs.length,
      archivedCount: archivedAvgs.length,
      unresolvedStage,
    },
    bands,
    stages,
    interviewers,
    // Most recent hire first — the useful reading order when checking recent decisions.
    hires: hires.sort((a, b) => (b.hiredAt ?? '').localeCompare(a.hiredAt ?? '')),
    roles,
  }
}
