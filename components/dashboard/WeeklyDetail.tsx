'use client'

import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from 'recharts'
import { WeekData, acceptRate, replyRate, fmt1 } from '@/lib/types'

// Outbound detail. Two sections:
//   1. Week × Recruiter — a Table OR a Graph (one line per recruiter) of the selected metric.
//   2. Full breakdown — per-period recruiter rows + team total, Weekly or Monthly.
// Accept/reply rates are over invites (see reply-rate redefinition).

type Metric = 'invites' | 'accepted' | 'messages' | 'replies'
const METRICS: { key: Metric; label: string }[] = [
  { key: 'invites', label: 'Invites' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'messages', label: 'Messages' },
  { key: 'replies', label: 'Replies' },
]
type MatrixView = 'table' | 'graph'
type Gran = 'weekly' | 'monthly'

interface Counts { invites: number; accepted: number; messages: number; replies: number; campaigns: number }
const zero = (): Counts => ({ invites: 0, accepted: 0, messages: 0, replies: 0, campaigns: 0 })

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LINE_COLORS = ['var(--ds-blue)', 'var(--ds-green-light)', 'var(--ds-amber)', '#a78bfa', '#f472b6', '#38bdf8']

function rateColor(pct: number): string {
  if (pct >= 25) return 'var(--ds-green-light)'
  if (pct >= 15) return 'var(--ds-amber)'
  return '#f87171'
}

interface Period { label: string; sortKey: string; byName: Map<string, Counts> }

function fromRow(r: { invites: number; accepted: number; messages: number; replies: number; campaigns: number }): Counts {
  return { invites: r.invites, accepted: r.accepted, messages: r.messages, replies: r.replies, campaigns: r.campaigns }
}

// Group weeks into periods (weekly = one per week; monthly = by the week's Monday month).
function buildPeriods(weeks: WeekData[], names: string[], gran: Gran): Period[] {
  if (gran === 'weekly') {
    return weeks.map((w) => {
      const byName = new Map<string, Counts>(names.map((n) => [n, zero()]))
      for (const r of w.rows) byName.set(r.name, fromRow(r))
      return { label: w.label, sortKey: w.weekStart ?? w.label, byName }
    })
  }
  const map = new Map<string, Period>()
  for (const w of weeks) {
    const d = w.weekStart ? new Date(w.weekStart) : null
    const key = d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` : w.label
    const label = d ? `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}` : w.label
    let e = map.get(key)
    if (!e) { e = { label, sortKey: key, byName: new Map(names.map((n) => [n, zero()])) }; map.set(key, e) }
    for (const r of w.rows) {
      const c = e.byName.get(r.name)!
      c.invites += r.invites; c.accepted += r.accepted; c.messages += r.messages; c.replies += r.replies
      c.campaigns = r.campaigns // current count, not summed
    }
  }
  return [...map.values()].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
}

function teamOf(p: Period, names: string[]): Counts {
  const t = zero()
  for (const n of names) {
    const c = p.byName.get(n)!
    t.invites += c.invites; t.accepted += c.accepted; t.messages += c.messages; t.replies += c.replies
  }
  return t
}

export function WeeklyDetail({ weeks }: { weeks: WeekData[] }) {
  const [matrixView, setMatrixView] = useState<MatrixView>('table')
  const [metric, setMetric] = useState<Metric>('invites')
  const [gran, setGran] = useState<Gran>('weekly')
  if (!weeks.length) return null

  const names: string[] = []
  for (const w of weeks) for (const r of w.rows) if (!names.includes(r.name)) names.push(r.name)

  const weekly = buildPeriods(weeks, names, 'weekly') // matrix/graph always weekly
  const breakdownPeriods = buildPeriods(weeks, names, gran)

  const UP = 'font-mono text-xs uppercase tracking-wide'
  const CARD = { backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }
  const pill = (active: boolean, activeColor: string) => ({
    backgroundColor: active ? activeColor : 'var(--ds-surface)',
    color: active ? '#fff' : 'var(--ds-muted)',
    border: `1px solid ${active ? activeColor : 'var(--ds-border)'}`,
  })

  // Chart data (chronological). One numeric series per recruiter for the selected metric.
  const chartData = weekly.map((p) => {
    const row: Record<string, string | number> = { label: p.label }
    for (const n of names) row[n] = p.byName.get(n)![metric]
    return row
  })

  const axis = { tick: { fill: 'var(--ds-dim)', fontSize: 11, fontFamily: 'DM Mono, monospace' }, axisLine: false as const, tickLine: false as const }
  const matrixNewestFirst = [...weekly].reverse()

  return (
    <div className="flex flex-col gap-4">
      <h2 className={UP} style={{ color: 'var(--ds-muted)' }}>Weekly Detail</h2>

      {/* ── Week × Recruiter: Table or Graph ────────────────────────────────────── */}
      <div className="rounded-lg overflow-hidden" style={CARD}>
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--ds-border)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={UP} style={{ color: 'var(--ds-muted)' }}>Week × Recruiter</span>
            <div className="flex gap-1">
              {(['table', 'graph'] as MatrixView[]).map((v) => (
                <button key={v} onClick={() => setMatrixView(v)}
                  className="font-mono text-xs px-3 py-1 rounded transition-colors capitalize"
                  style={pill(matrixView === v, 'var(--ds-blue)')}>{v}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-1">
            {METRICS.map((m) => (
              <button key={m.key} onClick={() => setMetric(m.key)}
                className="font-mono text-xs px-2.5 py-1 rounded transition-colors"
                style={pill(metric === m.key, 'var(--ds-green)')}>{m.label}</button>
            ))}
          </div>
        </div>

        {matrixView === 'graph' ? (
          <div className="p-4">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="var(--ds-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...axis} width={36} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#1c2333', border: '1px solid var(--ds-border)', borderRadius: 8, fontFamily: 'DM Mono, monospace', fontSize: 12 }}
                  labelStyle={{ color: 'var(--ds-muted)' }}
                />
                <Legend wrapperStyle={{ fontFamily: 'DM Mono, monospace', fontSize: 11 }} />
                {names.map((n, i) => (
                  <Line key={n} type="monotone" dataKey={n} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
                  <th className="px-4 py-3 font-normal" style={{ color: 'var(--ds-dim)' }}>Week</th>
                  {names.map((n) => <th key={n} className="px-4 py-3 text-right font-normal" style={{ color: 'var(--ds-dim)' }}>{n}</th>)}
                  <th className="px-4 py-3 text-right font-normal" style={{ color: 'var(--ds-text)' }}>Team</th>
                </tr>
              </thead>
              <tbody>
                {matrixNewestFirst.map((p, i) => {
                  const team = teamOf(p, names)
                  return (
                    <tr key={p.label} style={{ borderBottom: i < matrixNewestFirst.length - 1 ? '1px solid var(--ds-border)' : 'none' }}>
                      <td className="px-4 py-2.5" style={{ color: 'var(--ds-text)' }}>{p.label}</td>
                      {names.map((n) => (
                        <td key={n} className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-dim)' }}>{p.byName.get(n)![metric].toLocaleString()}</td>
                      ))}
                      <td className="px-4 py-2.5 text-right font-medium" style={{ color: 'var(--ds-green-light)' }}>{team[metric].toLocaleString()}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Full breakdown: Weekly or Monthly ───────────────────────────────────── */}
      <div className="rounded-lg overflow-hidden" style={CARD}>
        <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--ds-border)' }}>
          <span className={UP} style={{ color: 'var(--ds-muted)' }}>{gran === 'monthly' ? 'Monthly' : 'Full'} Breakdown</span>
          <div className="flex gap-1">
            {(['weekly', 'monthly'] as Gran[]).map((g) => (
              <button key={g} onClick={() => setGran(g)}
                className="font-mono text-xs px-3 py-1 rounded transition-colors capitalize"
                style={pill(gran === g, 'var(--ds-blue)')}>{g}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
                {[gran === 'monthly' ? 'Month' : 'Week', 'Recruiter', 'Invites', 'Accepted', 'Accept %', 'Messages', 'Replies', 'Reply %', 'Campaigns'].map((h) => (
                  <th key={h} className={`px-4 py-3 font-normal whitespace-nowrap ${h === 'Week' || h === 'Month' || h === 'Recruiter' ? 'text-left' : 'text-right'}`} style={{ color: 'var(--ds-dim)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...breakdownPeriods].reverse().map((p) => (
                <PeriodBlock key={p.sortKey} period={p} names={names} team={teamOf(p, names)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function cells(c: Counts) {
  const ar = acceptRate(c.accepted, c.invites)
  const rr = replyRate(c.replies, c.invites)
  return (
    <>
      <td className="px-4 py-2 text-right" style={{ color: 'var(--ds-text)' }}>{c.invites.toLocaleString()}</td>
      <td className="px-4 py-2 text-right" style={{ color: 'var(--ds-text)' }}>{c.accepted.toLocaleString()}</td>
      <td className="px-4 py-2 text-right font-medium" style={{ color: rateColor(ar) }}>{fmt1(ar)}%</td>
      <td className="px-4 py-2 text-right" style={{ color: 'var(--ds-text)' }}>{c.messages.toLocaleString()}</td>
      <td className="px-4 py-2 text-right" style={{ color: 'var(--ds-text)' }}>{c.replies.toLocaleString()}</td>
      <td className="px-4 py-2 text-right font-medium" style={{ color: rateColor(rr) }}>{fmt1(rr)}%</td>
      <td className="px-4 py-2 text-right" style={{ color: 'var(--ds-dim)' }}>{c.campaigns.toLocaleString()}</td>
    </>
  )
}

function PeriodBlock({ period, names, team }: { period: Period; names: string[]; team: Counts }) {
  return (
    <>
      {names.map((n, i) => (
        <tr key={n} style={{ borderTop: i === 0 ? '2px solid var(--ds-border)' : '1px solid rgba(255,255,255,0.04)' }}>
          {i === 0 ? (
            <td className="px-4 py-2 align-top font-medium" style={{ color: 'var(--ds-text)' }} rowSpan={names.length + 1}>{period.label}</td>
          ) : null}
          <td className="px-4 py-2" style={{ color: 'var(--ds-muted)' }}>{n}</td>
          {cells(period.byName.get(n)!)}
        </tr>
      ))}
      <tr style={{ backgroundColor: 'rgba(255,255,255,0.02)' }}>
        <td className="px-4 py-2 font-medium" style={{ color: 'var(--ds-text)' }}>Team total</td>
        {cells(team)}
      </tr>
    </>
  )
}
