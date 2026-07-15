'use client'

import { useState, useMemo } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, CartesianGrid,
} from 'recharts'

// ── constants ──────────────────────────────────────────────────────────────────
const C = {
  bg:     'var(--ds-bg)',
  surface:'var(--ds-surface)',
  border: 'var(--ds-border)',
  text:   'var(--ds-text)',
  muted:  'var(--ds-muted)',
  dim:    'var(--ds-dim)',
  green:  'var(--ds-green)',
  greenL: 'var(--ds-green-light)',
  blue:   'var(--ds-blue)',
  amber:  'var(--ds-amber)',
}
const CARD = { background: C.surface, border: `1px solid ${C.border}` }
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider'

const MONTHS: Record<string, number> = {
  January:0, February:1, March:2, April:3, May:4, June:5,
  July:6, August:7, September:8, October:9, November:10, December:11,
}
const MON_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── types ──────────────────────────────────────────────────────────────────────
interface AshbyRow {
  weekOf:    Date
  weekLabel: string   // "Jan 12"
  fullLabel: string   // "January 12, 2026"
  applicants: number
  relevant:   number
}

// ── helpers ────────────────────────────────────────────────────────────────────

// Turn a "January 12, 2026" label + counts into a full AshbyRow, or null if unparseable.
function rowFromParts(fullLabel: string, applicants: number, relevant: number): AshbyRow | null {
  const m = fullLabel.match(/^(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!m) return null
  const [, mon, day, year] = m
  const weekOf = new Date(parseInt(year), MONTHS[mon] ?? 0, parseInt(day))
  const weekLabel = `${MON_SHORT[MONTHS[mon] ?? 0]} ${parseInt(day)}`
  return { weekOf, weekLabel, fullLabel, applicants, relevant }
}

function parseCSV(raw: string): AshbyRow[] {
  // Normalize line endings, skip header
  const lines = raw.replace(/\r/g, '').trim().split('\n').slice(1)
  const rows: AshbyRow[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    // Handle quoted fields like "January 12, 2026"
    const cols: string[] = []
    let cur = ''
    let inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    cols.push(cur.trim())

    const row = rowFromParts(cols[0], parseInt(cols[1]) || 0, parseInt(cols[2]) || 0)
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => a.weekOf.getTime() - b.weekOf.getTime())
}

interface WeeklyRow { fullLabel: string; applicants: number; relevant: number }

// Prefer the live Ashby API (/api/ashby/weekly). If the key isn't configured yet, the route
// returns { configured: false } and we fall back to the published-sheet CSV (/api/ashby).
export async function fetchAshbyWeekly(): Promise<AshbyRow[]> {
  try {
    const res = await fetch('/api/ashby/weekly')
    if (res.ok) {
      const json = (await res.json()) as { configured?: boolean; rows?: WeeklyRow[] }
      if (json.configured && Array.isArray(json.rows)) {
        return json.rows
          .map(r => rowFromParts(r.fullLabel, r.applicants || 0, r.relevant || 0))
          .filter((r): r is AshbyRow => r !== null)
          .sort((a, b) => a.weekOf.getTime() - b.weekOf.getTime())
      }
    }
  } catch {
    // fall through to CSV
  }
  const csv = await fetch('/api/ashby').then(r => r.text())
  return parseCSV(csv)
}

type RangeId = 'all' | 'last90' | 'last30'

interface Range { id: RangeId; label: string; from?: Date; to?: Date }

// Narrowing windows that always differ from one another, regardless of how much
// history exists. (An earlier "YTD" option was dropped: with all data inside a single
// calendar year it was identical to "All time", so two of three buttons did nothing.)
function buildRanges(): Range[] {
  const now = new Date()
  const last90 = new Date(now); last90.setDate(now.getDate() - 90)
  const last30 = new Date(now); last30.setDate(now.getDate() - 30)
  return [
    { id: 'all',    label: 'All time' },
    { id: 'last90', label: 'Last 90d', from: last90 },
    { id: 'last30', label: 'Last 30d', from: last30 },
  ]
}

function filterRows(rows: AshbyRow[], range: Range): AshbyRow[] {
  return rows.filter(r => {
    if (range.from && r.weekOf < range.from) return false
    if (range.to   && r.weekOf > range.to)   return false
    return true
  })
}

interface GroupedRow { label: string; applicants: number; relevant: number; relRate: number }

function buildMonthlyData(rows: AshbyRow[]): GroupedRow[] {
  const map = new Map<string, { applicants: number; relevant: number }>()
  for (const r of rows) {
    const key = `${MON_SHORT[r.weekOf.getMonth()]} ${r.weekOf.getFullYear()}`
    const cur = map.get(key) ?? { applicants: 0, relevant: 0 }
    cur.applicants += r.applicants
    cur.relevant   += r.relevant
    map.set(key, cur)
  }
  return Array.from(map.entries()).map(([label, v]) => ({
    label,
    applicants: v.applicants,
    relevant:   v.relevant,
    relRate:    v.applicants > 0 ? parseFloat(((v.relevant / v.applicants) * 100).toFixed(1)) : 0,
  }))
}

function f0(n: number) { return n.toLocaleString() }
function f1(n: number) { return n.toFixed(1) }

// ── custom tooltip ──────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, pctMode }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]
  label?: string; pctMode?: boolean
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg px-3 py-2 font-mono text-xs" style={{ background: '#1c2333', border: `1px solid ${C.border}` }}>
      <div className="mb-1.5" style={{ color: C.muted }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span style={{ color: p.color }}>●</span>
          <span style={{ color: C.text }}>{p.name}:</span>
          <span style={{ color: p.color }}>{pctMode ? f1(p.value) + '%' : f0(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── main component ──────────────────────────────────────────────────────────────
export function AshbyDashboard() {
  const ranges = useMemo(buildRanges, [])
  const [rangeId, setRangeId] = useState<RangeId>('all')
  const [groupBy, setGroupBy] = useState<'week' | 'month'>('week')
  const [refreshing, setRefreshing] = useState(false)

  // Distinct SWR cache key from ExecutiveSummary — both read the same endpoint but map it
  // into different shapes, so they must not share a key (SWR dedupes by key).
  const { data: weekRows, isLoading, error } = useSWR<AshbyRow[]>('ashby-weekly:dashboard', fetchAshbyWeekly, { refreshInterval: 300_000 })

  async function handleRefresh() {
    setRefreshing(true)
    await globalMutate('ashby-weekly:dashboard')
    setRefreshing(false)
  }

  const allRows = weekRows ?? []
  const range   = ranges.find(r => r.id === rangeId) ?? ranges[0]
  const rows    = useMemo(() => filterRows(allRows, range), [allRows, range])

  // ── aggregates ────────────────────────────────────────────────────────────────
  const totalApplicants = rows.reduce((s, r) => s + r.applicants, 0)
  const totalRelevant   = rows.reduce((s, r) => s + r.relevant, 0)
  const relRate = totalApplicants > 0 ? (totalRelevant / totalApplicants) * 100 : 0
  const period = groupBy === 'month' ? 'mo' : 'wk'
  const periodLabel = groupBy === 'month' ? 'month' : 'week'
  const periodCount = groupBy === 'month' ? buildMonthlyData(rows).length : rows.length
  const avgPeriodApplicants = periodCount > 0 ? totalApplicants / periodCount : 0
  const avgPeriodRelevant   = periodCount > 0 ? totalRelevant   / periodCount : 0

  const avgRelRate = rows.length > 0
    ? rows.reduce((s, r) => s + (r.applicants > 0 ? (r.relevant / r.applicants) * 100 : 0), 0) / rows.length
    : 0

  // Sparkbar data for KPI (last 8 weeks of full dataset for context)
  const sparkRows = allRows.slice(-8)

  // Chart data — weekly or monthly
  const chartData = useMemo(() => {
    if (groupBy === 'month') return buildMonthlyData(rows)
    return rows.map(r => ({
      label:      r.weekLabel,
      applicants: r.applicants,
      relevant:   r.relevant,
      relRate:    r.applicants > 0 ? parseFloat(((r.relevant / r.applicants) * 100).toFixed(1)) : 0,
    }))
  }, [rows, groupBy])

  // Breakdown-table data — collapses to months when in monthly mode (chronological asc;
  // the table reverses to show newest first).
  const tableRows = useMemo(() => {
    if (groupBy === 'month') {
      return buildMonthlyData(rows).map(m => ({ label: m.label, applicants: m.applicants, relevant: m.relevant }))
    }
    return rows.map(r => ({ label: r.fullLabel, applicants: r.applicants, relevant: r.relevant }))
  }, [rows, groupBy])

  // Running cumulative
  const cumulativeData = (() => {
    let sumA = 0, sumR = 0
    return rows.map(r => {
      sumA += r.applicants
      sumR += r.relevant
      return {
        label:      r.weekLabel,
        applicants: sumA,
        relevant:   sumR,
        relRate:    sumA > 0 ? parseFloat(((sumR / sumA) * 100).toFixed(1)) : 0,
      }
    })
  })()

  // Best / worst weeks
  const bestApplicants = rows.length ? rows.reduce((b, r) => r.applicants > b.applicants ? r : b, rows[0]) : null
  const bestRelevant   = rows.length ? rows.reduce((b, r) => r.relevant   > b.relevant   ? r : b, rows[0]) : null
  const bestRelRate    = rows.length
    ? rows.reduce((b, r) => {
        const rv = r.applicants > 0 ? r.relevant / r.applicants : 0
        const bv = b.applicants > 0 ? b.relevant / b.applicants : 0
        return rv > bv ? r : b
      }, rows[0])
    : null

  if (isLoading || !weekRows) return (
    <div className="flex items-center justify-center h-64 font-mono text-sm" style={{ color: C.muted }}>
      Loading Ashby data...
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center h-64 font-mono text-sm" style={{ color: '#f87171' }}>
      Failed to load data.
    </div>
  )
  if (!rows.length) return (
    <div className="flex items-center justify-center h-64 font-mono text-sm" style={{ color: C.muted }}>
      No data for this period.
    </div>
  )

  const axisProps = {
    tick: { fill: C.dim, fontSize: 11, fontFamily: 'DM Mono, monospace' },
    axisLine: false as const,
    tickLine: false as const,
  }

  return (
    <div className="flex flex-col gap-8">

      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-medium" style={{ color: C.text }}>Ashby Inbound</h2>
          <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
            Perpetual job listing — weekly applicant &amp; relevance tracking
          </p>
        </div>

        {/* Range + groupBy + refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Weekly / Monthly toggle */}
          <div className="flex gap-0 p-1 rounded-lg" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            {(['week', 'month'] as const).map(g => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className="font-mono text-xs px-3 py-1.5 rounded-md transition-all capitalize"
                style={{
                  background: groupBy === g ? C.blue + '22' : 'none',
                  color:      groupBy === g ? C.blue : C.muted,
                  border:     groupBy === g ? `1px solid ${C.blue}44` : '1px solid transparent',
                }}
              >
                {g === 'week' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>

          <div className="flex gap-0 p-1 rounded-lg" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            {ranges.map(r => (
              <button
                key={r.id}
                onClick={() => setRangeId(r.id)}
                className="font-mono text-xs px-3 py-1.5 rounded-md transition-all"
                style={{
                  background: rangeId === r.id ? C.greenL + '22' : 'none',
                  color:      rangeId === r.id ? C.greenL : C.muted,
                  border:     rangeId === r.id ? `1px solid ${C.greenL}44` : '1px solid transparent',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
            title="Refresh from Ashby"
            className="flex items-center justify-center rounded-lg transition-all"
            style={{
              width: 34, height: 34,
              background: C.surface,
              border: `1px solid ${C.border}`,
              color: refreshing || isLoading ? C.dim : C.muted,
              cursor: refreshing || isLoading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: refreshing ? 'rotate(360deg)' : 'none', transition: refreshing ? 'transform 0.8s linear' : 'none' }}>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Applicants',                  value: f0(totalApplicants),  sub: `${f1(avgPeriodApplicants)}/${period} avg`,    color: C.blue,   spark: sparkRows.map(r => r.applicants) },
          { label: 'Total Relevant',                    value: f0(totalRelevant),    sub: `${f1(avgPeriodRelevant)}/${period} avg`,       color: C.greenL, spark: sparkRows.map(r => r.relevant) },
          { label: 'Relevance Rate',                    value: f1(relRate) + '%',    sub: `${f1(avgRelRate)}% avg/${periodLabel}`,        color: C.amber,  spark: sparkRows.map(r => r.applicants > 0 ? parseFloat(((r.relevant/r.applicants)*100).toFixed(1)) : 0) },
          { label: `${groupBy === 'month' ? 'Months' : 'Weeks'} Tracked`, value: String(periodCount), sub: `${rows[0]?.weekLabel} – ${rows[rows.length-1]?.weekLabel}`, color: C.muted, spark: [] },
        ].map(kpi => (
          <div key={kpi.label} className="rounded-lg p-5 flex flex-col gap-3" style={CARD}>
            <span className={UPLABEL} style={{ color: C.muted }}>{kpi.label}</span>
            <span className="text-3xl font-medium leading-none" style={{ color: kpi.color }}>{kpi.value}</span>
            {kpi.spark.length > 0 && (
              <div className="flex items-end gap-px h-6">
                {kpi.spark.map((v, i) => {
                  const max = Math.max(...kpi.spark, 1)
                  const h = Math.max(2, Math.round((v / max) * 24))
                  return (
                    <div key={i} className="flex-1 rounded-sm" style={{ height: h, background: kpi.color + '66' }} />
                  )
                })}
              </div>
            )}
            <span className="font-mono text-xs" style={{ color: C.dim }}>{kpi.sub}</span>
          </div>
        ))}
      </div>

      {/* Highlights */}
      {(bestApplicants || bestRelevant || bestRelRate) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: `Best ${groupBy === 'month' ? 'Month' : 'Week'} — Applicants`, row: bestApplicants, val: bestApplicants ? `${bestApplicants.applicants} applicants` : '', color: C.blue },
            { label: `Best ${groupBy === 'month' ? 'Month' : 'Week'} — Relevant`,   row: bestRelevant,   val: bestRelevant   ? `${bestRelevant.relevant} relevant`     : '', color: C.greenL },
            { label: `Best ${groupBy === 'month' ? 'Month' : 'Week'} — Rel. Rate`,  row: bestRelRate,    val: bestRelRate && bestRelRate.applicants > 0 ? `${f1((bestRelRate.relevant/bestRelRate.applicants)*100)}%` : '', color: C.amber },
          ].map(h => (
            <div key={h.label} className="rounded-lg p-4 flex items-center gap-4" style={CARD}>
              <div className="flex-1">
                <p className={UPLABEL} style={{ color: C.muted }}>{h.label}</p>
                <p className="mt-1 font-mono text-xs" style={{ color: C.dim }}>{h.row?.fullLabel}</p>
              </div>
              <span className="font-mono text-xl font-medium" style={{ color: h.color }}>{h.val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Weekly activity bar chart */}
      <div className="rounded-lg p-5" style={CARD}>
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <span className={UPLABEL} style={{ color: C.muted }}>{groupBy === 'month' ? 'Monthly' : 'Weekly'} Activity</span>
          <div className="flex items-center gap-4 font-mono text-xs" style={{ color: C.dim }}>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C.blue + '99' }} />Applicants</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: C.greenL + '99' }} />Relevant</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }} barGap={2}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} width={32} allowDecimals={false} />
            <Tooltip content={<ChartTooltip />} />
            <Bar dataKey="applicants" name="Applicants" fill={C.blue}   fillOpacity={0.7} radius={[3,3,0,0]} />
            <Bar dataKey="relevant"   name="Relevant"   fill={C.greenL} fillOpacity={0.7} radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Rate + cumulative row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Relevance rate over time */}
        <div className="rounded-lg p-5" style={CARD}>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <span className={UPLABEL} style={{ color: C.muted }}>Relevance Rate % per {groupBy === 'month' ? 'Month' : 'Week'}</span>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: C.amber + '22', color: C.amber }}>
              avg {f1(avgRelRate)}%
            </span>
          </div>
          <ResponsiveContainer width="100%" height={175}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} width={52} tickFormatter={v => f1(v) + '%'} domain={[0, 100]} />
              <Tooltip content={<ChartTooltip pctMode />} />
              <ReferenceLine y={avgRelRate} stroke={C.amber} strokeDasharray="4 4" strokeOpacity={0.5} />
              <Line type="monotone" dataKey="relRate" name="Relevance Rate" stroke={C.amber} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Cumulative */}
        <div className="rounded-lg p-5" style={CARD}>
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <span className={UPLABEL} style={{ color: C.muted }}>Cumulative Totals</span>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span style={{ color: C.blue   }}>{f0(totalApplicants)} total</span>
              <span style={{ color: C.greenL }}>{f0(totalRelevant)} relevant</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={175}>
            <LineChart data={cumulativeData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} width={36} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="applicants" name="Applicants" stroke={C.blue}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="relevant"   name="Relevant"   stroke={C.greenL} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detail table */}
      <div className="rounded-lg overflow-hidden" style={CARD}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
          <span className={UPLABEL} style={{ color: C.muted }}>{groupBy === 'month' ? 'Monthly' : 'Weekly'} Breakdown</span>
          <span className="font-mono text-xs" style={{ color: C.dim }}>{periodCount} {periodLabel}s</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {[groupBy === 'month' ? 'Month' : 'Week of', 'Applicants', 'Relevant', 'Rel. Rate', 'Bar'].map(h => (
                  <th key={h} className="px-5 py-3 text-left font-normal" style={{ color: C.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...tableRows].reverse().map((r, i) => {
                const rr = r.applicants > 0 ? (r.relevant / r.applicants) * 100 : 0
                const maxA = Math.max(...tableRows.map(x => x.applicants), 1)
                return (
                  <tr
                    key={r.label}
                    style={{ borderBottom: i < tableRows.length - 1 ? `1px solid ${C.border}` : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}
                  >
                    <td className="px-5 py-3" style={{ color: C.text }}>{r.label}</td>
                    <td className="px-5 py-3" style={{ color: C.blue }}>{r.applicants}</td>
                    <td className="px-5 py-3" style={{ color: C.greenL }}>{r.relevant}</td>
                    <td className="px-5 py-3" style={{ color: rr >= 50 ? C.greenL : rr >= 25 ? C.amber : C.muted }}>
                      {f1(rr)}%
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-0.5 items-end h-4">
                        <div className="rounded-sm" style={{ width: 8, height: Math.max(2, (r.applicants / maxA) * 16), background: C.blue + '88' }} />
                        <div className="rounded-sm" style={{ width: 8, height: Math.max(2, (r.relevant   / maxA) * 16), background: C.greenL + '88' }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
