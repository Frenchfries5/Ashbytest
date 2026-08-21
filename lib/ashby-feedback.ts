import { supabase } from './supabase'

// Shared scorecard loader. Everything that reads Ashby feedback goes through here so the weekly
// digest, the email and the Pipeline scorecard view can't disagree about what counts as a scorecard.
//
// Two corrections happen here, both learned from real rows:
//
//  1. One scorecard slot can produce several feedback rows. An interviewer submits, then someone
//     re-submits it for them — Ashby keeps both, same interview event and same `creditedToUser`,
//     different feedback ids. Counting rows made a 3-scorecard candidate read as four.
//  2. `submitted_by` is whoever typed it, which is not always whose scorecard it is. When a
//     coordinator fills a form on an interviewer's behalf, the feedback belongs to
//     `creditedToUser`. Attribution and de-duplication both key off that.

// 'Recruiting' is a shared Ashby login the team uses alongside Megan's own account, so scorecards
// credited to it are hers. Folded together to keep one row per real interviewer.
const ALIAS: Record<string, string> = { Recruiting: 'Megan Kidd' }

export interface Scorecard {
  id: string
  applicationId: string
  score: number
  submittedAt: string | null
  eventId: string | null
  interviewer: string // creditedToUser — whose assessment this is
  submittedBy: string // who actually entered it; differs when filled on someone's behalf
}

interface Row {
  id: string
  application_id: string | null
  overall_recommendation: number | null
  submitted_at: string | null
  submitted_by: string | null
  event_id: string | null
  credited_first: string | null
  credited_last: string | null
}

const COLUMNS =
  'id, application_id, overall_recommendation, submitted_at, submitted_by, ' +
  'event_id:raw->>interviewEventId, credited_first:raw->creditedToUser->>firstName, ' +
  'credited_last:raw->creditedToUser->>lastName'

export async function loadScorecards(): Promise<Scorecard[]> {
  const out: Scorecard[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('ashby_feedback').select(COLUMNS).range(from, from + 999)
    if (error) return out
    const rows = (data ?? []) as unknown as Row[]
    for (const r of rows) {
      if (!r.application_id || r.overall_recommendation == null) continue
      const credited = [r.credited_first, r.credited_last].filter(Boolean).join(' ').trim()
      // Fall back to the submitter when Ashby didn't record a credited user.
      const interviewer = credited || r.submitted_by?.trim() || 'Unattributed'
      out.push({
        id: r.id,
        applicationId: r.application_id,
        score: r.overall_recommendation,
        submittedAt: r.submitted_at,
        eventId: r.event_id,
        interviewer: ALIAS[interviewer] ?? interviewer,
        submittedBy: r.submitted_by?.trim() || 'Unattributed',
      })
    }
    if (rows.length < 1000) break
  }
  return out
}

// Collapse re-submissions of the same scorecard slot, keeping the most recent. Callers that scope
// to a time window should filter FIRST and dedupe after, so "as of last week" keeps the version
// that stood then rather than one written later.
export function dedupeScorecards(rows: Scorecard[]): Scorecard[] {
  const bySlot = new Map<string, Scorecard>()
  const loose: Scorecard[] = []
  for (const r of rows) {
    // Without an interview event there's nothing reliable to group on, so the row stands alone.
    if (!r.eventId) { loose.push(r); continue }
    const key = `${r.applicationId}|${r.eventId}|${r.interviewer}`
    const prev = bySlot.get(key)
    if (!prev || (r.submittedAt ?? '') > (prev.submittedAt ?? '')) bySlot.set(key, r)
  }
  return [...bySlot.values(), ...loose].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''))
}
