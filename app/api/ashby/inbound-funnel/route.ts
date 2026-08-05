import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { queryApplications, type CachedAppRow } from '@/lib/ashby-cache'

export const dynamic = 'force-dynamic'

// ONE pooled inbound funnel. Every inbound application counts the same regardless of how it
// arrived — LinkedIn job slots, a manual LinkedIn post, a direct apply, a referral link — because
// they're all the same event (someone applied) and Ashby records all of them. Channel is a
// breakdown dimension (see the Channels view), not a separate funnel.
//
// Scope: the sales/broker reqs this team actually sources for. Engineering/ops/intern reqs and the
// test copies would otherwise dominate the totals without reflecting this funnel.
//
// Advancement is measured from INTERVIEW EVENTS, not current stage. An archived application loses
// its stage history (everything decays to "Archived"), which made the stage-based estimate read 36
// of 715 while 253 of those people demonstrably sat through an interview. Events don't decay.

const SALES_REQ = /broker|account manager/i
const TEST_REQ = /\btest\b/i

// The postings tracker labels each post with a role (Growth / Core / AM). Those map onto Ashby
// reqs by title, so the role filter at the top of the tab can scope this funnel too — otherwise
// picking "Core" would filter the posts above while the funnel below still showed every req.
const ROLE_REQ: Record<string, RegExp> = {
  growth: /broker.*growth/i,
  core: /broker.*core/i,
  am: /account manager/i,
}

function reqMatcher(role: string | null): RegExp {
  if (!role || role === 'all') return SALES_REQ
  return ROLE_REQ[role.toLowerCase()] ?? SALES_REQ
}

// Screening/pre-interview stages — an event at any other stage means they got past the screen.
const EARLY_STAGE = /new lead|reached out|replied|application review|holding tank|recruiter screen|introduction call|sourced/i

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface FunnelStep {
  applications: number
  screened: number   // sat through at least one interview of any kind
  advanced: number   // had an interview at a stage past the screen
  hired: number
}

export async function GET(req: NextRequest) {
  try {
    const role = req.nextUrl.searchParams.get('role')
    const matcher = reqMatcher(role)

    const [{ data: jobRows, error: jobErr }, appRows] = await Promise.all([
      supabase.from('ashby_jobs').select('id, title'),
      queryApplications(),
    ])
    if (jobErr || !appRows) {
      return NextResponse.json(
        { configured: false, applications: 0, screened: 0, advanced: 0, hired: 0, monthly: [], channels: [], reqs: [], dataStart: null },
        { headers: { 'Cache-Control': 'no-store' } }
      )
    }

    const reqs = (jobRows ?? []).filter(
      (j) => typeof j.title === 'string' && matcher.test(j.title) && !TEST_REQ.test(j.title)
    ) as { id: string; title: string }[]
    const reqIds = new Set(reqs.map((j) => j.id))
    const inScope: CachedAppRow[] = appRows.filter((a) => a.job_id && reqIds.has(a.job_id))
    const scopeIds = new Set(inScope.map((a) => a.id))

    // Interview events for in-scope applications (paged — the table can exceed one select).
    const screenedIds = new Set<string>()
    const advancedIds = new Set<string>()
    const firstInterviewAt = new Map<string, number>() // application id → earliest interview start
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('ashby_interviews')
        .select('application_id, stage_title, start_time')
        .range(from, from + 999)
      if (error) break
      const rows = data ?? []
      for (const e of rows) {
        const appId = e.application_id as string | null
        if (!appId || !scopeIds.has(appId)) continue
        screenedIds.add(appId)
        const stage = e.stage_title as string | null
        if (stage && !EARLY_STAGE.test(stage)) advancedIds.add(appId)
        const t = e.start_time ? Date.parse(e.start_time as string) : NaN
        if (!isNaN(t)) {
          const prev = firstInterviewAt.get(appId)
          if (prev === undefined || t < prev) firstInterviewAt.set(appId, t)
        }
      }
      if (rows.length < 1000) break
    }

    let dataStart: string | null = null
    let hired = 0
    const months = new Map<string, { month: string } & FunnelStep>()
    const channels = new Map<string, { channel: string } & FunnelStep>()
    // Days from application to first interview — how fast inbound actually gets a response.
    // Collected as raw samples so the reported figure can be a median (a couple of stale
    // applications screened months later would drag a mean badly).
    const screenLagAll: number[] = []
    const screenLagByMonth = new Map<string, number[]>()

    for (const a of inScope) {
      const isHired = a.status === 'Hired'
      const isScreened = screenedIds.has(a.id)
      const isAdvanced = advancedIds.has(a.id)
      if (isHired) hired += 1
      if (a.created_at && (!dataStart || a.created_at < dataStart)) dataStart = a.created_at

      if (a.created_at) {
        const key = a.created_at.slice(0, 7)
        const m = months.get(key) ?? { month: key, applications: 0, screened: 0, advanced: 0, hired: 0 }
        m.applications += 1
        if (isScreened) m.screened += 1
        if (isAdvanced) m.advanced += 1
        if (isHired) m.hired += 1
        months.set(key, m)

        const first = firstInterviewAt.get(a.id)
        if (first !== undefined) {
          const days = (first - Date.parse(a.created_at)) / 86_400_000
          // Drop negatives (interview logged before the application record) and >180d outliers,
          // which are re-engaged old applicants rather than inbound response time.
          if (days >= 0 && days <= 180) {
            screenLagAll.push(days)
            const arr = screenLagByMonth.get(key) ?? []
            arr.push(days)
            screenLagByMonth.set(key, arr)
          }
        }
      }

      const ck = a.source ?? 'Unknown'
      const c = channels.get(ck) ?? { channel: ck, applications: 0, screened: 0, advanced: 0, hired: 0 }
      c.applications += 1
      if (isScreened) c.screened += 1
      if (isAdvanced) c.advanced += 1
      if (isHired) c.hired += 1
      channels.set(ck, c)
    }

    return NextResponse.json(
      {
        configured: true,
        role: role ?? 'all',
        applications: inScope.length,
        screened: screenedIds.size,
        advanced: advancedIds.size,
        hired,
        dataStart,
        reqs: reqs.map((r) => r.title),
        daysToScreen: median(screenLagAll),
        daysToScreenSample: screenLagAll.length,
        monthly: [...months.values()]
          .sort((a, b) => a.month.localeCompare(b.month))
          .map((m) => ({ ...m, daysToScreen: median(screenLagByMonth.get(m.month) ?? []) })),
        channels: [...channels.values()].sort((a, b) => b.applications - a.applications),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: false, error: String(err instanceof Error ? err.message : err), applications: 0, screened: 0, advanced: 0, hired: 0, monthly: [], channels: [], reqs: [], dataStart: null },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
