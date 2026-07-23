import { supabase } from './supabase'
import { weekStartUTC, weekLabel, DAY } from './week'

// Recruiter-screen funnel, read from the synced ashby_interviews table (not live Ashby).
// A "recruiter screen" = a completed interview event whose stage is titled "Recruiter Screen".
// "Moved forward" = a screened candidate who later had an interview at a stage ordered AFTER
// their recruiter screen (within the application's plan, stage_order is directly comparable).
// Screens are also attributed to the interviewer who ran them (from the event's raw payload),
// so the tab can filter by recruiter.

interface EventRow {
  application_id: string | null
  candidate_id: string | null
  stage_title: string | null
  start_time: string
  raw: { interviewers?: { firstName?: string; lastName?: string }[] } | null
}

export interface FunnelCell { screens: number; movedForward: number }
export interface FunnelWeek {
  weekStart: string
  label: string
  total: FunnelCell
  byInterviewer: Record<string, FunnelCell>
}

// A "screen" is a recruiter screen OR a General Interest introduction call (blended, per product
// decision). EARLY = the screening/pre-screen stages; any completed interview at a stage NOT in
// this set counts as a real interview round past the screen (i.e. "moved forward").
const SCREEN = /recruiter screen|introduction call/i
const EARLY = /new lead|reached out|replied|application review|holding tank|recruiter screen|introduction call|sourced/i

// "Recruiting" is an alias Megan uses for General Interest calls — fold it into her name so it
// isn't a separate filter option and her totals include those screens.
const INTERVIEWER_ALIASES: Record<string, string> = { Recruiting: 'Megan Kidd' }

function interviewerNames(raw: EventRow['raw']): string[] {
  const names = (raw?.interviewers ?? [])
    .map((i) => `${i.firstName ?? ''} ${i.lastName ?? ''}`.trim())
    .filter(Boolean)
    .map((n) => INTERVIEWER_ALIASES[n] ?? n)
  return [...new Set(names)] // dedupe in case an event lists both the alias and the real name
}

// Group events by PERSON (candidate when available, else the application), so a candidate who
// moves from a General Interest intro call to a real-job req is tracked as one person.
function personKey(r: EventRow): string | null {
  return r.candidate_id ?? r.application_id ?? null
}

function add<K>(m: Map<K, Set<string>>, k: K, v: string) {
  let s = m.get(k); if (!s) { s = new Set(); m.set(k, s) }
  s.add(v)
}

async function loadFunnel(weekCount: number): Promise<{ weeks: FunnelWeek[]; interviewers: string[] } | null> {
  const currentMonday = weekStartUTC(Date.now())
  const windowStart = currentMonday - (weekCount - 1) * 7 * DAY

  const { data, error } = await supabase
    .from('ashby_interviews')
    .select('application_id, candidate_id, stage_title, start_time, raw')
  if (error) return null // table/column missing → unavailable
  const rows = (data ?? []) as EventRow[]

  // A person "moved forward" if they have ANY completed interview at a real round past the screen
  // (stage not in EARLY), in any of their applications. Event-based, so it survives later
  // archiving and works across pipelines.
  const advancedPeople = new Set<string>()
  for (const r of rows) {
    const p = personKey(r)
    if (p && r.stage_title && !EARLY.test(r.stage_title)) advancedPeople.add(p)
  }

  const allByWeek = new Map<number, Set<string>>()                 // week → set of screened people
  const intByWeek = new Map<number, Map<string, Set<string>>>()    // week → interviewer → set of people
  const interviewers = new Set<string>()

  for (const r of rows) {
    const p = personKey(r)
    if (!p || !r.stage_title || !SCREEN.test(r.stage_title)) continue
    const t = Date.parse(r.start_time); if (isNaN(t)) continue
    const wk = weekStartUTC(t)
    add(allByWeek, wk, p)
    let perInt = intByWeek.get(wk); if (!perInt) { perInt = new Map(); intByWeek.set(wk, perInt) }
    for (const n of interviewerNames(r.raw)) { interviewers.add(n); add(perInt, n, p) }
  }

  const cell = (people: Set<string> | undefined): FunnelCell => {
    if (!people) return { screens: 0, movedForward: 0 }
    let mf = 0
    for (const p of people) if (advancedPeople.has(p)) mf++
    return { screens: people.size, movedForward: mf }
  }

  const names = [...interviewers].sort()
  const weeks: FunnelWeek[] = []
  for (let wk = windowStart; wk <= currentMonday; wk += 7 * DAY) {
    const perInt = intByWeek.get(wk)
    const byInterviewer: Record<string, FunnelCell> = {}
    for (const n of names) byInterviewer[n] = cell(perInt?.get(n))
    weeks.push({ weekStart: new Date(wk).toISOString().slice(0, 10), label: weekLabel(wk), total: cell(allByWeek.get(wk)), byInterviewer })
  }
  return { weeks, interviewers: names }
}

export async function getRecruiterScreenFunnel(weekCount = 12): Promise<{ configured: boolean; weeks: FunnelWeek[]; interviewers: string[] }> {
  const res = await loadFunnel(weekCount)
  if (!res) return { configured: false, weeks: [], interviewers: [] }
  return { configured: true, ...res }
}

export interface RecruiterScreensScorecard {
  thisWeek: number
  lastWeek: number | null
}

interface WeeklyRpcRow { week_start: string; stage_title: string | null; cnt: number }

// Tile figures — via the aggregate RPC (doesn't need stage_order), so the Exec Summary tile keeps
// working independently of the funnel's stage_order backfill.
export async function getRecruiterScreensScorecard(): Promise<RecruiterScreensScorecard | null> {
  const currentMonday = weekStartUTC(Date.now())
  const prevMonday = currentMonday - 7 * DAY
  const since = new Date(prevMonday).toISOString()

  const { data, error } = await supabase.rpc('ashby_interviews_weekly', { since })
  if (error) return null

  const rows = (data ?? []) as WeeklyRpcRow[]
  let thisWeek = 0
  let lastWeek = 0
  for (const r of rows) {
    if (!r.stage_title || !SCREEN.test(r.stage_title)) continue
    const wk = weekStartUTC(Date.parse(r.week_start))
    if (wk === currentMonday) thisWeek += Number(r.cnt)
    else if (wk === prevMonday) lastWeek += Number(r.cnt)
  }
  return { thisWeek, lastWeek }
}
