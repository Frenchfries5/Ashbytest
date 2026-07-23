'use client'

import { useMemo, type ReactNode } from 'react'
import useSWR from 'swr'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { Mail, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import { WeekData } from '@/lib/types'
import {
  AshbyWeek, parseAshbyWeeks, pctChange, f0,
  computeOutboundScorecard, computeInboundScorecard, computeHiresScorecard, buildHeadline,
} from '@/lib/executive-summary'
import type { WeeklyRow } from '@/lib/ashby-weekly'
import type { WeeklyHireCount } from '@/lib/ashby-hires'

// ── fetchers ─────────────────────────────────────────────────────────────────
const jsonFetcher = (url: string) => fetch(url).then((r) => r.json())

// Live Ashby weekly data. Returns [] if Ashby isn't configured.
export async function fetchAshbyWeeks(): Promise<AshbyWeek[]> {
  const res = await fetch('/api/ashby/weekly')
  if (!res.ok) return []
  const json = (await res.json()) as { configured?: boolean; rows?: WeeklyRow[] }
  if (!json.configured || !Array.isArray(json.rows)) return []
  return parseAshbyWeeks(json.rows)
}

export async function fetchWeeklyHires(): Promise<WeeklyHireCount[]> {
  const res = await fetch('/api/ashby/hires')
  if (!res.ok) return []
  const json = (await res.json()) as { configured?: boolean; weeks?: WeeklyHireCount[] }
  if (!json.configured || !Array.isArray(json.weeks)) return []
  return json.weeks
}

// Recruiter screens completed this week / last week (from the synced ashby_interviews table).
// null when the sync hasn't run / table isn't there yet — distinct from a real zero.
export async function fetchRecruiterScreens(): Promise<{ thisWeek: number; lastWeek: number | null } | null> {
  const res = await fetch('/api/ashby/recruiter-screens')
  if (!res.ok) return null
  const json = (await res.json()) as { configured?: boolean; thisWeek?: number; lastWeek?: number | null }
  if (!json.configured) return null
  return { thisWeek: json.thisWeek ?? 0, lastWeek: json.lastWeek ?? null }
}

interface FunnelCell { screens: number; movedForward: number }
interface FunnelWeek { weekStart: string; label: string; total: FunnelCell; byInterviewer: Record<string, FunnelCell> }
// Weekly recruiter-screen funnel (screens + moved forward, by interviewer) for the quality-signal chart.
export async function fetchInterviewFunnel(): Promise<{ configured: boolean; weeks: FunnelWeek[] }> {
  const res = await fetch('/api/ashby/interviews/funnel')
  if (!res.ok) return { configured: false, weeks: [] }
  const json = (await res.json()) as { configured?: boolean; weeks?: FunnelWeek[] }
  if (!json.configured) return { configured: false, weeks: [] }
  return { configured: true, weeks: json.weeks ?? [] }
}

// Offer-stage count + Growth-role active pipeline total, from the open-pipeline snapshot.
// Each is null when Ashby isn't configured; growthPipeline is also null when there's no open
// Growth role. (Only growthPipeline is surfaced on this lean view; offerStage stays available
// for the weekly email digest.)
export async function fetchPipelineOutcomes(): Promise<{ offerStage: number | null; growthPipeline: number | null }> {
  const res = await fetch('/api/ashby/pipeline')
  if (!res.ok) return { offerStage: null, growthPipeline: null }
  const json = (await res.json()) as {
    configured?: boolean
    totals?: { offerStage?: number }
    roles?: { title: string; total: number }[]
  }
  if (!json.configured) return { offerStage: null, growthPipeline: null }
  const growthRoles = (json.roles ?? []).filter((r) => /growth/i.test(r.title))
  const growthPipeline = growthRoles.length ? growthRoles.reduce((s, r) => s + (r.total ?? 0), 0) : null
  return { offerStage: json.totals?.offerStage ?? 0, growthPipeline }
}

// ── design constants (match existing dashboard tokens) ───────────────────────
const C = {
  bg: 'var(--ds-bg)', surface: 'var(--ds-surface)', border: 'var(--ds-border)',
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green)', greenL: 'var(--ds-green-light)', blue: 'var(--ds-blue)',
  amber: 'var(--ds-amber)', red: '#f87171',
}
const CARD = { backgroundColor: C.surface, border: `1px solid ${C.border}` }
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider'

// ── linear regression (quality-signal trend) ─────────────────────────────────
function linReg(vals: (number | null)[]): (number | null)[] {
  const pts = vals.map((v, i) => v !== null ? [i, v] as [number, number] : null).filter(Boolean) as [number, number][]
  if (pts.length < 2) return vals.map(() => null)
  const n = pts.length
  const sumX  = pts.reduce((s, [x]) => s + x, 0)
  const sumY  = pts.reduce((s, [, y]) => s + y, 0)
  const sumXY = pts.reduce((s, [x, y]) => s + x * y, 0)
  const sumX2 = pts.reduce((s, [x]) => s + x * x, 0)
  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const b = (sumY - m * sumX) / n
  return vals.map((v, i) => v !== null ? parseFloat((m * i + b).toFixed(2)) : null)
}

function todayLabel(): string {
  const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = new Date()
  return `${MON_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// ── delta badge ──────────────────────────────────────────────────────────────
function Delta({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <span className="font-mono text-xs" style={{ color: C.dim }}>—</span>
  }
  const flat = Math.abs(pct) < 0.05
  const up = pct > 0
  const color = flat ? C.muted : up ? C.greenL : C.red
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-xs" style={{ color }}>
      <Icon size={13} strokeWidth={2.5} />
      {`${pct >= 0 ? '+' : ''}${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%`}
    </span>
  )
}

// ── one hero stat cell ───────────────────────────────────────────────────────
function Stat({ label, value, delta }: { label: string; value: string; delta?: ReactNode }) {
  return (
    <div className="p-4 flex flex-col gap-1.5 rounded-lg" style={CARD}>
      <span className={UPLABEL} style={{ color: C.muted }}>{label}</span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[26px] leading-none font-medium" style={{ color: C.text }}>{value}</span>
        {delta}
      </div>
    </div>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────
export function ExecutiveSummary({ onJump }: { onJump?: (t: 'sourcing' | 'inbound' | 'ashby') => void }) {
  const { data: weeksRes } = useSWR<{ weeks: WeekData[] }>('/api/meetalfred/sourcing', jsonFetcher)
  const { data: ashbyData } = useSWR<AshbyWeek[]>('ashby-weekly:summary', fetchAshbyWeeks, { refreshInterval: 300_000 })
  const { data: hiresData } = useSWR<WeeklyHireCount[]>('ashby-hires:summary', fetchWeeklyHires, { refreshInterval: 300_000 })
  const { data: pipelineOutcomes } = useSWR('ashby-pipeline-outcomes:summary', fetchPipelineOutcomes, { refreshInterval: 300_000 })
  const { data: recruiterScreens } = useSWR('ashby-recruiter-screens:summary', fetchRecruiterScreens, { refreshInterval: 300_000 })
  const { data: funnel } = useSWR('ashby-interviews-funnel:summary', fetchInterviewFunnel, { refreshInterval: 300_000 })

  const weeks: WeekData[] = weeksRes?.weeks ?? []
  const ashby = ashbyData ?? []
  const hireWeeks = hiresData ?? []
  const growthPipeline = pipelineOutcomes?.growthPipeline ?? null

  const outbound = useMemo(() => computeOutboundScorecard(weeks), [weeks])
  const inbound = useMemo(() => computeInboundScorecard(ashby), [ashby])
  const hires = useMemo(() => computeHiresScorecard(hireWeeks), [hireWeeks])

  // The five hero numbers: outbound activity → traction → inbound quality → outcome → leading
  // indicator. Delta is week-over-week only; everything else lives on the detail tabs.
  const hero: { label: string; value: string; delta?: ReactNode }[] = [
    {
      label: 'Invites',
      value: f0(outbound.invites),
      delta: <Delta pct={outbound.invitesPrev !== null ? pctChange(outbound.invites, outbound.invitesPrev) : null} />,
    },
    {
      label: 'Replies',
      value: f0(outbound.replies),
      delta: <Delta pct={outbound.repliesPrev !== null ? pctChange(outbound.replies, outbound.repliesPrev) : null} />,
    },
    ...(inbound ? [{
      label: 'Relevant inbound',
      value: f0(inbound.relevant),
      delta: <Delta pct={inbound.relevantPrev !== null ? pctChange(inbound.relevant, inbound.relevantPrev) : null} />,
    }] : []),
    ...(recruiterScreens ? [{
      label: 'Recruiter screens',
      value: f0(recruiterScreens.thisWeek),
      delta: <Delta pct={recruiterScreens.lastWeek !== null ? pctChange(recruiterScreens.thisWeek, recruiterScreens.lastWeek) : null} />,
    }] : []),
    {
      label: 'Hires this week',
      value: f0(hires.thisWeek),
      delta: <Delta pct={hires.lastWeek !== null ? pctChange(hires.thisWeek, hires.lastWeek) : null} />,
    },
    ...(growthPipeline !== null ? [{
      label: 'Growth pipeline',
      value: f0(growthPipeline),
    }] : []),
  ]

  // Quality-signal trend: last 8 weeks of Megan's recruiter screens vs how many moved forward.
  const MEGAN = 'Megan Kidd'
  const trend = useMemo(() => {
    const wk = (funnel?.weeks ?? []).slice(-8)
    const out = wk.map((w) => {
      const c = w.byInterviewer?.[MEGAN] ?? { screens: 0, movedForward: 0 }
      return { label: w.label, screens: c.screens, moved: c.movedForward }
    })
    const screensTrend = linReg(out.map((p) => p.screens))
    const movedTrend = linReg(out.map((p) => p.moved))
    return out.map((p, i) => ({ ...p, screensTrend: screensTrend[i], movedTrend: movedTrend[i] }))
  }, [funnel])

  const headline = useMemo(() => buildHeadline(outbound, inbound, hires), [outbound, inbound, hires])

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-medium leading-tight" style={{ color: C.text }}>Executive summary</h1>
        <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
          Week ending {todayLabel()} · for leadership
        </p>
      </div>

      {/* Headline narrative — the summary in one sentence */}
      <div className="rounded-lg p-5 flex gap-3 items-start" style={{ ...CARD, borderLeft: `3px solid ${C.greenL}` }}>
        <Mail size={18} style={{ color: C.greenL, marginTop: 2, flexShrink: 0 }} />
        <p className="text-[15px] leading-relaxed" style={{ color: C.text }}>{headline}</p>
      </div>

      {/* Hero strip — the numbers that matter, week over week */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {hero.map((s) => <Stat key={s.label} label={s.label} value={s.value} delta={s.delta} />)}
      </div>

      {/* Quality-signal trend — the one visual: are results trending up */}
      <div className="rounded-lg p-5" style={CARD}>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <span className={UPLABEL} style={{ color: C.muted }}>Quality signal — last 8 weeks</span>
          <span className="font-mono text-[11px]" style={{ color: C.dim }}>recruiter screens (Megan) vs moved forward</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={trend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#484f58', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#484f58', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              contentStyle={{ backgroundColor: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
              labelStyle={{ color: '#e6edf3' }}
              itemStyle={{ color: '#8b949e' }}
              formatter={(v: number, name: string) => [v?.toLocaleString() ?? '—', name]}
            />
            <Legend wrapperStyle={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: '#8b949e', paddingTop: 8 }} />
            <Line type="linear" dataKey="screensTrend" stroke={C.blue}   strokeWidth={1.5} dot={false} opacity={0.3} connectNulls legendType="none" tooltipType="none" />
            <Line type="linear" dataKey="movedTrend"   stroke={C.greenL} strokeWidth={1.5} dot={false} opacity={0.3} connectNulls legendType="none" tooltipType="none" />
            <Bar dataKey="screens" name="Recruiter screens" fill={C.blue}   radius={[2,2,0,0]} opacity={0.75} />
            <Bar dataKey="moved"   name="Moved forward"     fill={C.greenL} radius={[2,2,0,0]} opacity={0.75} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {onJump && (
        <div className="flex gap-2 flex-wrap pb-2">
          {([['sourcing', 'Outbound detail'], ['inbound', 'Inbound postings'], ['ashby', 'Ashby detail']] as const).map(([k, label]) => (
            <button key={k} onClick={() => onJump(k)}
              className="font-mono text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{ color: C.muted, backgroundColor: C.surface, border: `1px solid ${C.border}` }}>
              {label} →
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
