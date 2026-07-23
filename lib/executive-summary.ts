// Shared Executive Summary calculations — used by both the client dashboard
// (components/dashboard/ExecutiveSummary.tsx) and the server-side weekly email
// (app/api/email/weekly/route.ts), so the two never drift apart.

import { WeekData, aggregateWeek, acceptRate, replyRate } from '@/lib/types'
import { isCurrentWeekStart } from '@/lib/week'
import type { WeeklyRow } from '@/lib/ashby-weekly'
import type { WeeklyHireCount } from '@/lib/ashby-hires'

const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}

// ── small helpers ────────────────────────────────────────────────────────────
export function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return ((curr - prev) / prev) * 100
}
export function f0(n: number): string { return n.toLocaleString() }
export function signed(n: number, digits = 0): string { return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}` }

export function rollingAvg(values: number[], n = 4): number | null {
  if (!values.length) return null
  const tail = values.slice(-n)
  return tail.reduce((s, v) => s + v, 0) / tail.length
}

// ── Ashby weekly parse ───────────────────────────────────────────────────────
export interface AshbyWeek { weekStart: string; label: string; applicants: number; relevant: number }

function weekFromParts(fullLabel: string, applicants: number, relevant: number): AshbyWeek | null {
  const m = fullLabel.match(/^(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!m) return null
  const [, mon, day, year] = m
  const monthIdx = MONTHS[mon] ?? 0
  const weekStartMs = Date.UTC(parseInt(year), monthIdx, parseInt(day))
  return {
    weekStart: new Date(weekStartMs).toISOString().slice(0, 10),
    label: `${MON_SHORT[monthIdx]} ${parseInt(day)}`,
    applicants,
    relevant,
  }
}

export function parseAshbyWeeks(rows: WeeklyRow[]): AshbyWeek[] {
  return rows
    .map((r) => weekFromParts(r.fullLabel, r.applicants || 0, r.relevant || 0))
    .filter((r): r is AshbyWeek => r !== null)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

// ── Outbound scorecard (always present — defaults to zero while loading) ─────
export interface OutboundScorecard {
  label: string
  invites: number; invitesPrev: number | null; invitesRollingAvg: number | null
  replies: number; repliesPrev: number | null; repliesRollingAvg: number | null
  replyRate: number; replyRatePrev: number | null; replyRateRollingAvg: number | null
  acceptRate: number; acceptRatePrev: number | null; acceptRateRollingAvg: number | null
}

const ZERO_AGG = { invites: 0, accepted: 0, messages: 0, replies: 0 }

// The in-progress week always starts at 0 and climbs through the week — excluded from the
// scorecard and rolling averages the same way it's excluded on the Outbound Sourcing tab.
export function computeOutboundScorecard(weeks: WeekData[]): OutboundScorecard {
  const completed = weeks.filter((w) => !isCurrentWeekStart(w.weekStart))
  const agg = completed.map(aggregateWeek)
  const now = agg[agg.length - 1] ?? ZERO_AGG
  const prev = agg.length > 1 ? agg[agg.length - 2] : null
  const label = completed[completed.length - 1]?.label ?? ''

  return {
    label,
    invites: now.invites, invitesPrev: prev?.invites ?? null,
    invitesRollingAvg: rollingAvg(agg.map((a) => a.invites)),
    replies: now.replies, repliesPrev: prev?.replies ?? null,
    repliesRollingAvg: rollingAvg(agg.map((a) => a.replies)),
    replyRate: replyRate(now.replies, now.invites),
    replyRatePrev: prev ? replyRate(prev.replies, prev.invites) : null,
    replyRateRollingAvg: rollingAvg(agg.map((a) => replyRate(a.replies, a.invites))),
    acceptRate: acceptRate(now.accepted, now.invites),
    acceptRatePrev: prev ? acceptRate(prev.accepted, prev.invites) : null,
    acceptRateRollingAvg: rollingAvg(agg.map((a) => acceptRate(a.accepted, a.invites))),
  }
}

// ── Inbound scorecard (null entirely when Ashby has no data — section is hidden) ─
export interface InboundScorecard {
  label: string
  applicants: number; applicantsPrev: number | null; applicantsRollingAvg: number | null
  relevant: number; relevantPrev: number | null; relevantRollingAvg: number | null
  relRate: number | null; relRatePrev: number | null; relRateRollingAvg: number | null
}

function relRateOf(w: AshbyWeek): number | null {
  return w.applicants ? (w.relevant / w.applicants) * 100 : null
}

export function computeInboundScorecard(ashby: AshbyWeek[]): InboundScorecard | null {
  const completed = ashby.filter((w) => !isCurrentWeekStart(w.weekStart))
  if (!completed.length) return null
  const now = completed[completed.length - 1]
  const prev = completed.length > 1 ? completed[completed.length - 2] : null
  const relRateSeries = completed.map(relRateOf).filter((v): v is number => v !== null)

  return {
    label: now.label,
    applicants: now.applicants, applicantsPrev: prev?.applicants ?? null,
    applicantsRollingAvg: rollingAvg(completed.map((w) => w.applicants)),
    relevant: now.relevant, relevantPrev: prev?.relevant ?? null,
    relevantRollingAvg: rollingAvg(completed.map((w) => w.relevant)),
    relRate: relRateOf(now), relRatePrev: prev ? relRateOf(prev) : null,
    relRateRollingAvg: rollingAvg(relRateSeries),
  }
}

// ── Hires scorecard ────────────────────────────────────────────────────────────
// getWeeklyHireCounts always returns buckets ending at the current week, so the last entry
// IS "this week" by construction; the rolling average is over the completed weeks before it.
export interface HiresScorecard { thisWeek: number; lastWeek: number | null; rollingAvg: number | null }

export function computeHiresScorecard(weeks: WeeklyHireCount[]): HiresScorecard {
  const thisWeek = weeks[weeks.length - 1]?.count ?? 0
  const lastWeek = weeks.length > 1 ? weeks[weeks.length - 2].count : null
  const completed = weeks.slice(0, -1)
  return { thisWeek, lastWeek, rollingAvg: rollingAvg(completed.map((w) => w.count)) }
}

// ── Auto-narrative headline ────────────────────────────────────────────────────
export function buildHeadline(
  outbound: OutboundScorecard,
  inbound: InboundScorecard | null,
  hires: HiresScorecard
): string {
  const parts: string[] = []

  const invD = outbound.invitesPrev !== null ? pctChange(outbound.invites, outbound.invitesPrev) : null
  if (outbound.invitesPrev !== null && invD !== null) {
    parts.push(`Outbound invites ${invD >= 0 ? 'up' : 'down'} ${Math.abs(invD).toFixed(0)}% (${f0(outbound.invites)} sent)`)
  } else {
    parts.push(`${f0(outbound.invites)} outbound invites sent`)
  }

  const repD = outbound.repliesPrev !== null ? pctChange(outbound.replies, outbound.repliesPrev) : null
  if (outbound.repliesPrev !== null && repD !== null) {
    parts.push(`replies ${repD >= 0 ? 'up' : 'down'} ${Math.abs(repD).toFixed(0)}%`)
  }

  if (inbound && inbound.relevantPrev !== null) {
    const relD = pctChange(inbound.relevant, inbound.relevantPrev)
    if (relD !== null) {
      parts.push(`inbound relevant applicants ${relD >= 0 ? 'up' : 'down'} ${Math.abs(relD).toFixed(0)}% (${f0(inbound.relevant)})`)
    }
  } else if (inbound) {
    parts.push(`${f0(inbound.relevant)} relevant inbound applicants`)
  }

  parts.push(`${f0(hires.thisWeek)} hire${hires.thisWeek === 1 ? '' : 's'} this week`)

  const joined = parts.join('; ')
  return joined.charAt(0).toUpperCase() + joined.slice(1) + '.'
}
