import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { DAY, weekStartUTC, weekLabel } from '@/lib/week'

export const dynamic = 'force-dynamic'

// Weekly outbound metrics, now served from Supabase (populated by the sync job) instead of
// paging MeetAlfred live — so this is fast and rate-limit-free. Aggregation happens in the
// `meetalfred_weekly` RPC; here we just shape it into the per-week × per-user grid the page
// expects (same JSON contract as before, minus the live campaign counts).

interface RpcRow {
  week_start: string
  member_id: number
  member_name: string
  action_type: string
  cnt: number
}

type Metric = 'invites' | 'accepted' | 'messages' | 'replies'
const zero = () => ({ invites: 0, accepted: 0, messages: 0, replies: 0 })

export async function GET(req: NextRequest) {
  const weeks = Math.min(52, Math.max(1, Number(req.nextUrl.searchParams.get('weeks')) || 12))

  const currentMonday = weekStartUTC(Date.now())
  const firstMonday = currentMonday - (weeks - 1) * 7 * DAY
  const cutoffISO = new Date(firstMonday).toISOString()

  const [aggRes, stateRes] = await Promise.all([
    supabase.rpc('meetalfred_weekly', { since: cutoffISO }),
    supabase.from('site_state').select('last_meetalfred_query').eq('id', 1).maybeSingle(),
  ])

  if (aggRes.error) {
    // Most likely the schema/RPC hasn't been created yet.
    return NextResponse.json(
      { configured: false, error: aggRes.error.message, hint: 'Run supabase/meetalfred.sql, then backfill.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const rows = (aggRes.data ?? []) as RpcRow[]
  const lastSyncedAt: string | null = stateRes.data?.last_meetalfred_query ?? null

  // Distinct members, ordered by id (Ralph → Mike → Raynaldo, matching the sheet).
  const memberMap = new Map<number, string>()
  for (const r of rows) memberMap.set(r.member_id, r.member_name)
  const members = [...memberMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([memberId, name]) => ({ memberId, name }))

  // member id -> weekMondayMs -> counts
  const byMember = new Map<number, Map<number, ReturnType<typeof zero>>>()
  for (const m of members) byMember.set(m.memberId, new Map())
  for (const r of rows) {
    const wk = weekStartUTC(Date.parse(r.week_start))
    const buckets = byMember.get(r.member_id)!
    const c = buckets.get(wk) ?? zero()
    if (r.action_type in c) c[r.action_type as Metric] += Number(r.cnt)
    buckets.set(wk, c)
  }

  // Emit every week in the window (ascending), zero-filled, with per-member rows + team totals.
  const weekMondays: number[] = []
  for (let w = firstMonday; w <= currentMonday; w += 7 * DAY) weekMondays.push(w)

  const weekRows = weekMondays.map((wk) => {
    const memberRows = members.map((m) => {
      const c = byMember.get(m.memberId)?.get(wk) ?? zero()
      return { name: m.name, memberId: m.memberId, ...c }
    })
    const totals = memberRows.reduce(
      (acc, r) => ({
        invites: acc.invites + r.invites,
        accepted: acc.accepted + r.accepted,
        messages: acc.messages + r.messages,
        replies: acc.replies + r.replies,
      }),
      zero()
    )
    return { weekStart: new Date(wk).toISOString().slice(0, 10), label: weekLabel(wk), rows: memberRows, totals }
  })

  return NextResponse.json(
    {
      configured: true,
      windowWeeks: weeks,
      lastSyncedAt,
      members,
      weeks: weekRows,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
