import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { DAY, weekStartUTC, weekLabel } from '@/lib/week'
import type { WeekData, RecruiterRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Source of truth for the Outbound Sourcing tab: returns the full weekly history as WeekData[]
// (the same shape the old spreadsheet-backed /api/data returned), built from the MeetAlfred
// events synced into Supabase. The `campaigns` field is each recruiter's CURRENT active
// campaign count (from meetalfred_members) applied to every week — MeetAlfred events don't
// carry historical campaign counts, so this is a current-state stand-in, not per-week history.

interface RpcRow {
  week_start: string
  member_id: number
  member_name: string
  action_type: string
  cnt: number
}

type Metric = 'invites' | 'accepted' | 'messages' | 'replies'
const zeroCounts = () => ({ invites: 0, accepted: 0, messages: 0, replies: 0 })

export async function GET() {
  // Whole history: pass an epoch-ish floor so the RPC returns every week.
  const { data, error } = await supabase.rpc('meetalfred_weekly', { since: '2000-01-01T00:00:00Z' })
  if (error) {
    return NextResponse.json({ weeks: [], error: error.message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  const rows = (data ?? []) as RpcRow[]
  if (rows.length === 0) {
    return NextResponse.json({ weeks: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Current active-campaign count per member — best-effort (table may not exist yet).
  const campaigns = new Map<number, number>()
  const mem = await supabase.from('meetalfred_members').select('member_id, campaigns_active')
  if (!mem.error) {
    for (const m of mem.data ?? []) campaigns.set(m.member_id as number, (m.campaigns_active as number) ?? 0)
  }

  // Members ordered by id (Ralph → Mike → Raynaldo, matching the sheet).
  const memberMap = new Map<number, string>()
  for (const r of rows) memberMap.set(r.member_id, r.member_name)
  const members = [...memberMap.entries()].sort((a, b) => a[0] - b[0])

  // member id -> weekMondayMs -> counts
  const byMember = new Map<number, Map<number, ReturnType<typeof zeroCounts>>>()
  for (const [id] of members) byMember.set(id, new Map())
  let earliest = Infinity
  for (const r of rows) {
    const wk = weekStartUTC(Date.parse(r.week_start))
    earliest = Math.min(earliest, wk)
    const buckets = byMember.get(r.member_id)!
    const c = buckets.get(wk) ?? zeroCounts()
    if (['invites', 'accepted', 'messages', 'replies'].includes(r.action_type)) {
      c[r.action_type as Metric] += Number(r.cnt)
    }
    buckets.set(wk, c)
  }

  // Emit weeks from the earliest event through the current week, zero-filled — but cap to the
  // most recent WINDOW_WEEKS so the trend charts and week-selector stay readable. (The account
  // has ~2yr of history; a stray old event would otherwise stretch the axis across ~100 mostly
  // empty weeks.) Bump this or add a UI range control if longer history is wanted.
  const WINDOW_WEEKS = 26
  const currentMonday = weekStartUTC(Date.now())
  const windowStart = currentMonday - (WINDOW_WEEKS - 1) * 7 * DAY
  const start = Math.max(earliest, windowStart)
  const weeks: WeekData[] = []
  for (let wk = start; wk <= currentMonday; wk += 7 * DAY) {
    const wkRows: RecruiterRow[] = members.map(([id, name]) => {
      const c = byMember.get(id)?.get(wk) ?? zeroCounts()
      return {
        name,
        invites: c.invites,
        accepted: c.accepted,
        messages: c.messages,
        replies: c.replies,
        campaigns: campaigns.get(id) ?? 0,
      }
    })
    weeks.push({ label: weekLabel(wk), weekStart: new Date(wk).toISOString().slice(0, 10), rows: wkRows })
  }

  return NextResponse.json({ weeks }, { headers: { 'Cache-Control': 'no-store' } })
}
