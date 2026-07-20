'use client'

import { useState, useMemo } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, ComposedChart,
} from 'recharts'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Row {
  id?: number               // inbound_postings.id (present for DB-backed rows)
  poster: string
  date: string | null       // ISO yyyy-mm-dd
  title: string
  views: number | null
  applicants: number | null
  relevant: number | null
  duration: number | null
  role: string
  platform: string
  paid: boolean
  note: string
}

// A row as returned by /api/inbound/postings (DB shape).
interface DbPosting {
  id: number
  poster: string | null
  date_posted: string | null
  title: string | null
  views: number | null
  applicants: number | null
  relevant: number | null
  duration_days: number | null
  date_removed: string | null
  role: string | null
  platform: string | null
  paid: boolean
  note: string | null
}

function postingToRow(p: DbPosting): Row {
  return {
    id: p.id,
    poster: p.poster ?? '',
    date: p.date_posted ?? null,
    title: p.title ?? '',
    views: p.views,
    applicants: p.applicants,
    relevant: p.relevant,
    duration: p.duration_days,
    role: p.role ?? '',
    platform: p.platform || 'Unspecified',
    paid: !!p.paid,
    note: p.note ?? '',
  }
}

interface MonthBucket {
  label: string
  sortKey: number
  posts: number
  views: number
  applicants: number
  relevant: number
  relevantMeasuredApps: number
}

interface PosterAgg {
  name: string
  posts: number
  views: number
  applicants: number
  relevant: number
  avgDur: number
  applyRate: number
}

interface PlatformAgg {
  platform: string
  posts: number
  views: number
  applicants: number
}

interface Aggregates {
  totalPosts: number
  totalViews: number
  totalApplicants: number
  totalRelevant: number
  avgDuration: number
  dateStart: string
  dateEnd: string
  monthly: MonthBucket[]
  posters: PosterAgg[]
  platforms: PlatformAgg[]
  rows: Row[]
}

// ── Date range helpers ─────────────────────────────────────────────────────────

interface Range { id: string; label: string; from: string; to: string }

function buildRanges(minDate: string, maxDate: string): Range[] {
  const today = new Date(maxDate + 'T00:00:00')
  function ymd(d: Date) { return d.toISOString().slice(0, 10) }
  function minusDays(n: number) { const d = new Date(today); d.setDate(d.getDate() - n); return ymd(d) }
  const yr = today.getFullYear()
  return [
    { id: 'all',   label: 'All time',     from: minDate,          to: maxDate },
    { id: 'ytd',   label: 'YTD',          from: `${yr}-01-01`,    to: maxDate },
    { id: '90d',   label: 'Last 90 days', from: minusDays(90),    to: maxDate },
    { id: 'y2025', label: '2025',         from: '2025-01-01',     to: '2025-12-31' },
  ]
}

function monthKey(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleString('en-US', { month: 'short' }) + ' ' + String(d.getFullYear()).slice(2)
}
function monthSort(iso: string): number {
  const d = new Date(iso + 'T00:00:00')
  return d.getFullYear() * 12 + d.getMonth()
}

function buildAggregates(rows: Row[]): Aggregates {
  const dates = rows.map(r => r.date).filter(Boolean).sort() as string[]
  const totalViews = rows.reduce((s, r) => s + (r.views ?? 0), 0)
  const totalApplicants = rows.reduce((s, r) => s + (r.applicants ?? 0), 0)
  const totalRelevant = rows.reduce((s, r) => s + (r.relevant ?? 0), 0)
  const durs = rows.filter(r => r.duration != null).map(r => r.duration!)
  const avgDuration = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0

  // monthly
  const mMap: Record<string, MonthBucket> = {}
  rows.forEach(r => {
    if (!r.date) return
    const k = monthKey(r.date)
    if (!mMap[k]) mMap[k] = { label: k, sortKey: monthSort(r.date), posts: 0, views: 0, applicants: 0, relevant: 0, relevantMeasuredApps: 0 }
    mMap[k].posts++
    mMap[k].views += r.views ?? 0
    mMap[k].applicants += r.applicants ?? 0
    mMap[k].relevant += r.relevant ?? 0
    if (r.relevant != null) mMap[k].relevantMeasuredApps += r.applicants ?? 0
  })
  const monthly = Object.values(mMap).sort((a, b) => a.sortKey - b.sortKey)

  // posters
  const pMap: Record<string, { views: number; applicants: number; relevant: number; durs: number[]; posts: number }> = {}
  rows.forEach(r => {
    if (!pMap[r.poster]) pMap[r.poster] = { views: 0, applicants: 0, relevant: 0, durs: [], posts: 0 }
    const p = pMap[r.poster]
    p.posts++
    p.views += r.views ?? 0
    p.applicants += r.applicants ?? 0
    p.relevant += r.relevant ?? 0
    if (r.duration != null) p.durs.push(r.duration)
  })
  const posters: PosterAgg[] = Object.entries(pMap).map(([name, p]) => ({
    name,
    posts: p.posts,
    views: p.views,
    applicants: p.applicants,
    relevant: p.relevant,
    avgDur: p.durs.length ? p.durs.reduce((a, b) => a + b, 0) / p.durs.length : 0,
    applyRate: p.views ? (p.applicants / p.views) * 100 : 0,
  })).sort((a, b) => b.posts - a.posts)

  // platforms
  const plMap: Record<string, PlatformAgg> = {}
  rows.forEach(r => {
    const k = r.platform
    if (!plMap[k]) plMap[k] = { platform: k, posts: 0, views: 0, applicants: 0 }
    plMap[k].posts++
    plMap[k].views += r.views ?? 0
    plMap[k].applicants += r.applicants ?? 0
  })

  return {
    totalPosts: rows.length, totalViews, totalApplicants, totalRelevant, avgDuration,
    dateStart: dates.length ? fmtDate(dates[0]) : '—',
    dateEnd: dates.length ? fmtDate(dates[dates.length - 1]) : '—',
    monthly, posters, platforms: Object.values(plMap), rows,
  }
}

// ── Formatting ─────────────────────────────────���───────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDateShort(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
function f1(n: number) { return n.toFixed(1) }
function pct(a: number, b: number) { return b ? (a / b) * 100 : 0 }

function rateColor(p: number): string {
  if (p >= 12) return 'var(--ds-green-light)'
  if (p >= 7)  return 'var(--ds-amber)'
  return '#f87171'
}

// ── Design tokens ──────────────────────────────────────────────────────────────

const C = {
  green: '#1a9e6e', greenL: '#3adea0', blue: '#378add',
  amber: '#c98a1a', red: '#f87171', muted: '#8b949e', dim: '#484f58',
  surface: '#161b22', grid: 'rgba(255,255,255,0.04)',
}

const POSTER_PALETTE = ['#60a5fa', '#3adea0', '#f472b6', '#c98a1a', '#a78bfa', '#fb923c', '#34d399']

// ── Sparkbar SVG ───────────────────────────────────────────────────────────────

function SparkBars({ values, color, height = 32 }: { values: number[]; color: string; height?: number }) {
  const vals = values.length ? values : [0]
  const max = Math.max(...vals, 1)
  const w = 120, h = height
  const bw = w / vals.length
  const gap = bw * 0.25
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      {vals.map((v, i) => {
        const bh = Math.max(2, (v / max) * (h - 2))
        const x = i * bw + gap / 2
        return <rect key={i} x={x} y={h - bh} width={bw - gap} height={bh} rx={1.5} fill={color} opacity={0.85} />
      })}
    </svg>
  )
}

// ── Chart tooltip ──────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, pctMode }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; pctMode?: boolean }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg px-3 py-2 text-xs font-mono" style={{ background: '#1c2330', border: '1px solid rgba(255,255,255,0.08)', color: 'var(--ds-text)' }}>
      <div className="mb-1" style={{ color: C.muted }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span style={{ color: C.muted }}>{p.name}:</span>
          <span>{pctMode ? `${f1(p.value)}%` : p.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── Keyword grouping ───────────────────────────────────────────────────────────

const KEYWORD_GROUPS: { label: string; keywords: string[] }[] = [
  { label: 'Broker',            keywords: ['broker'] },
  { label: 'Producer',          keywords: ['producer'] },
  { label: 'Account Executive', keywords: ['account executive'] },
  { label: 'Agent',             keywords: ['agent'] },
  { label: 'Risk Consultant',   keywords: ['consultant', 'advisor'] },
  { label: 'Other',             keywords: [] },
]

function classifyTitle(title: string): string {
  const t = title.toLowerCase()
  for (const g of KEYWORD_GROUPS) {
    if (g.label === 'Other') continue
    if (g.keywords.some(kw => t.includes(kw))) return g.label
  }
  return 'Other'
}

interface KeywordAgg {
  label: string
  posts: number
  views: number
  applicants: number
  relevant: number
  applyRate: number
  relRate: number
  avgDuration: number
  titlesUsed: string[]
}

function buildKeywordAggs(rows: Row[]): KeywordAgg[] {
  const map = new Map<string, { views: number; applicants: number; relevant: number; durs: number[]; posts: number; titles: Set<string> }>()
  for (const g of KEYWORD_GROUPS) {
    map.set(g.label, { views: 0, applicants: 0, relevant: 0, durs: [], posts: 0, titles: new Set() })
  }
  for (const r of rows) {
    const key = classifyTitle(r.title)
    const bucket = map.get(key)!
    bucket.posts++
    bucket.views += r.views ?? 0
    bucket.applicants += r.applicants ?? 0
    bucket.relevant += r.relevant ?? 0
    if (r.duration != null) bucket.durs.push(r.duration)
    if (r.title) bucket.titles.add(r.title.trim())
  }
  return KEYWORD_GROUPS.map(g => {
    const b = map.get(g.label)!
    return {
      label: g.label,
      posts: b.posts,
      views: b.views,
      applicants: b.applicants,
      relevant: b.relevant,
      applyRate: b.views > 0 ? (b.applicants / b.views) * 100 : 0,
      relRate:   b.applicants > 0 ? Math.round((b.relevant / b.applicants) * 1000) / 10 : 0,
      avgDuration: b.durs.length ? b.durs.reduce((a, v) => a + v, 0) / b.durs.length : 0,
      titlesUsed: Array.from(b.titles).sort(),
    }
  }).filter(k => k.posts > 0)
}

const KW_PALETTE = ['#60a5fa', '#3adea0', '#f472b6', '#c98a1a', '#a78bfa', '#fb923c']

// ── Fetcher ────────────────────────────────────────────────────────────────────

const jsonFetcher = (url: string) => fetch(url).then(r => r.json())
const POSTINGS_KEY = '/api/inbound/postings'

// ── Sort key type ──────────────────────────────────────────────────────────────

type SortKey = 'date' | 'poster' | 'title' | 'views' | 'applicants' | 'apply' | 'relevant' | 'relRate' | 'duration' | 'role'

// ── Main component ─────────────────────────────────────────────────────────────

export function InboundDashboard({ admin = false }: { admin?: boolean }) {
  const { data, isLoading, error } = useSWR<{ postings: DbPosting[] }>(POSTINGS_KEY, jsonFetcher, { refreshInterval: 300_000 })
  const [refreshing, setRefreshing] = useState(false)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)

  async function handleRefresh() {
    setRefreshing(true)
    await globalMutate(POSTINGS_KEY)
    setRefreshing(false)
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this posting?')) return
    await fetch(`${POSTINGS_KEY}/${id}`, { method: 'DELETE' })
    await globalMutate(POSTINGS_KEY)
  }

  const allRows = useMemo(() => (data?.postings ?? []).map(postingToRow), [data])

  const allDates = useMemo(() => allRows.map(r => r.date).filter(Boolean).sort() as string[], [allRows])
  const minDate = allDates[0] ?? '2024-01-01'
  const maxDate = allDates[allDates.length - 1] ?? new Date().toISOString().slice(0, 10)
  const ranges = useMemo(() => buildRanges(minDate, maxDate), [minDate, maxDate])

  const [rangeId, setRangeId] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [detailPoster, setDetailPoster] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const activeRange = ranges.find(r => r.id === rangeId) ?? ranges[0]

  // derive sorted unique roles from all rows (not filtered, so pills don't disappear)
  const allRoles = useMemo(() => {
    const s = new Set(allRows.map(r => r.role).filter(Boolean))
    return Array.from(s).sort()
  }, [allRows])

  const filteredRows = useMemo(
    () => allRows.filter(r => {
      if (!r.date || r.date < activeRange.from || r.date > activeRange.to) return false
      if (roleFilter !== 'all' && r.role !== roleFilter) return false
      return true
    }),
    [allRows, activeRange, roleFilter]
  )

  const agg = useMemo(() => buildAggregates(filteredRows), [filteredRows])

  // If current poster filter no longer exists in this range, reset
  const posterNames = agg.posters.map(p => p.name)
  const effectivePoster = posterNames.includes(detailPoster) ? detailPoster : 'all'

  // poster color map
  const posterColorMap = useMemo(() => {
    const m: Record<string, string> = {}
    posterNames.forEach((n, i) => { m[n] = POSTER_PALETTE[i % POSTER_PALETTE.length] })
    return m
  }, [posterNames])

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(['title', 'poster', 'role'].includes(k) ? 'asc' : 'desc') }
  }

  // detail table rows
  const detailRows = useMemo(() => {
    let rows = effectivePoster === 'all' ? agg.rows : agg.rows.filter(r => r.poster === effectivePoster)
    return [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      let av: string | number | null, bv: string | number | null
      if (sortKey === 'apply') {
        av = a.views ? pct(a.applicants ?? 0, a.views) : -Infinity
        bv = b.views ? pct(b.applicants ?? 0, b.views) : -Infinity
      } else if (sortKey === 'relRate') {
        av = a.applicants ? pct(a.relevant ?? 0, a.applicants) : -Infinity
        bv = b.applicants ? pct(b.relevant ?? 0, b.applicants) : -Infinity
      } else {
        av = a[sortKey as keyof Row] as string | number | null
        bv = b[sortKey as keyof Row] as string | number | null
      }
      if (av == null) av = -Infinity as number
      if (bv == null) bv = -Infinity as number
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir
      return ((av as number) - (bv as number)) * dir
    })
  }, [agg.rows, effectivePoster, sortKey, sortDir])

  // monthly series for poster sparkbars
  function posterMonthlySeries(name: string, field: 'applicants' | 'views'): number[] {
    const byMonth: Record<string, number> = {}
    agg.monthly.forEach(m => { byMonth[m.label] = 0 })
    agg.rows.forEach(r => {
      if (r.poster !== name || !r.date) return
      const k = monthKey(r.date)
      if (k in byMonth) byMonth[k] += r[field] ?? 0
    })
    return Object.values(byMonth)
  }

  // rate chart data
  const rateData = agg.monthly.map(m => ({
    label: m.label,
    applyRate: m.views ? pct(m.applicants, m.views) : 0,
    relevanceRate: m.relevantMeasuredApps ? pct(m.relevant, m.relevantMeasuredApps) : null,
  }))
  const avgApply = rateData.length ? rateData.reduce((s, d) => s + d.applyRate, 0) / rateData.length : 0
  const relValid = rateData.filter(d => d.relevanceRate != null).map(d => d.relevanceRate!)
  const avgRel = relValid.length ? relValid.reduce((s, v) => s + v, 0) / relValid.length : 0

  // detail summary
  const summaryRows = effectivePoster === 'all' ? agg.rows : agg.rows.filter(r => r.poster === effectivePoster)
  const sumViews = summaryRows.reduce((s, r) => s + (r.views ?? 0), 0)
  const sumApps = summaryRows.reduce((s, r) => s + (r.applicants ?? 0), 0)

  const CARD = { backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10 } as const
  const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider block'

  const keywordAggs = useMemo(() => buildKeywordAggs(filteredRows), [filteredRows])

  const SortArrow = ({ k }: { k: SortKey }) => (
    <span className="opacity-50 text-[9px] ml-0.5">
      {sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </span>
  )

  const isNoData = agg.totalPosts === 0

  return (
    <div className="flex flex-col gap-8">

      {/* Hero + range + role filter */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-medium leading-tight text-balance" style={{ color: 'var(--ds-text)' }}>
            Inbound postings
          </h1>
          <p className="mt-1 font-mono text-sm" style={{ color: 'var(--ds-muted)' }}>
            {isLoading ? 'Loading…' : error ? 'Could not load data' : `${agg.dateStart} – ${agg.dateEnd}`}
          </p>
        </div>

        {/* Range buttons + refresh */}
        <div className="flex items-center gap-2">
          <div className="flex gap-0 p-1 rounded-lg" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
            {ranges.map(r => (
              <button
                key={r.id}
              onClick={() => setRangeId(r.id)}
              className="font-mono text-xs px-3.5 py-1.5 rounded-md transition-all whitespace-nowrap"
              style={{
                background: rangeId === r.id ? C.blue : 'transparent',
                color: rangeId === r.id ? '#fff' : C.muted,
                border: 'none',
                boxShadow: rangeId === r.id ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              {r.label}
            </button>
          ))}
          </div>

          {admin && (
            <button
              onClick={() => setEditing('new')}
              className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all whitespace-nowrap"
              style={{ background: 'var(--ds-green)', color: '#fff', border: '1px solid var(--ds-green)', flexShrink: 0 }}
            >
              + Add posting
            </button>
          )}

          <button
            onClick={handleRefresh}
            disabled={refreshing || isLoading}
            title="Refresh"
            className="flex items-center justify-center rounded-lg transition-all"
            style={{
              width: 34, height: 34,
              background: 'var(--ds-surface)',
              border: '1px solid var(--ds-border)',
              color: refreshing || isLoading ? 'var(--ds-dim)' : 'var(--ds-muted)',
              cursor: refreshing || isLoading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: refreshing ? 'rotate(360deg)' : 'none', transition: refreshing ? 'transform 0.8s linear' : 'none' }}
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Role filter */}
      {allRoles.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: 'var(--ds-dim)' }}>Role</span>
          <div className="flex gap-1.5 flex-wrap">
            {['all', ...allRoles].map(role => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className="font-mono text-xs px-2.5 py-1 rounded-md transition-all"
                style={{
                  background: roleFilter === role ? 'var(--ds-green)' + '33' : 'var(--ds-surface)',
                  color: roleFilter === role ? 'var(--ds-green-light)' : 'var(--ds-muted)',
                  border: `1px solid ${roleFilter === role ? 'var(--ds-green)' + '66' : 'var(--ds-border)'}`,
                }}
              >
                {role === 'all' ? 'All roles' : role}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <span className="font-mono text-sm" style={{ color: 'var(--ds-muted)' }}>Loading…</span>
        </div>
      )}

      {isNoData && !isLoading && (
        <div className="flex items-center justify-center py-24 rounded-lg" style={CARD}>
          <div className="text-center">
            <p className="font-mono text-sm" style={{ color: 'var(--ds-muted)' }}>No postings in this date range.</p>
            <p className="font-mono text-xs mt-1" style={{ color: 'var(--ds-dim)' }}>Try a wider range above.</p>
          </div>
        </div>
      )}

      {!isLoading && !isNoData && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Views',      value: agg.totalViews.toLocaleString(),      spark: agg.monthly.map(m => m.views),      color: C.green },
              { label: 'Total Applicants', value: agg.totalApplicants.toLocaleString(), spark: agg.monthly.map(m => m.applicants), color: C.greenL },
              { label: 'Apply Rate',       value: f1(pct(agg.totalApplicants, agg.totalViews)) + '%', spark: agg.monthly.map(m => pct(m.applicants, m.views)), color: C.blue },
              { label: 'Avg Days Live',    value: f1(agg.avgDuration),                  spark: agg.monthly.map(m => m.posts),      color: C.amber },
            ].map(kpi => (
              <div key={kpi.label} className="flex flex-col gap-2 p-4 rounded-lg" style={CARD}>
                <span className={UPLABEL} style={{ color: 'var(--ds-muted)' }}>{kpi.label}</span>
                <span className="font-mono text-[26px] font-medium leading-none" style={{ color: 'var(--ds-text)' }}>{kpi.value}</span>
                <SparkBars values={kpi.spark} color={kpi.color} height={32} />
              </div>
            ))}
          </div>

          {/* Activity over time chart */}
          <div className="rounded-lg p-5" style={CARD}>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <span className={UPLABEL} style={{ color: 'var(--ds-muted)' }}>Activity Over Time</span>
              <div className="flex gap-4 flex-wrap font-mono text-[11px]" style={{ color: 'var(--ds-muted)' }}>
                {[{ label: 'Views', color: C.green }, { label: 'Applicants', color: C.blue }, { label: 'Relevant', color: C.greenL }].map(l => (
                  <span key={l.label} className="flex items-center gap-1.5">
                    <span className="inline-block w-2.5 h-0.5 rounded-sm" style={{ background: l.color }} />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <LineChart data={agg.monthly} margin={{ top: 4, right: 10, bottom: 4, left: 0 }}>
                <XAxis dataKey="label" tick={{ fill: C.dim, fontSize: 10.5, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: C.dim, fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="views"      name="Views"      stroke={C.green}  strokeWidth={2} dot={agg.monthly.length === 1} />
                <Line type="monotone" dataKey="applicants" name="Applicants" stroke={C.blue}   strokeWidth={2} dot={agg.monthly.length === 1} />
                <Line type="monotone" dataKey="relevant"   name="Relevant"   stroke={C.greenL} strokeWidth={2} dot={agg.monthly.length === 1} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Rate charts side-by-side */}
          <div className="flex flex-col md:flex-row gap-3">
            {/* Apply rate */}
            <div className="flex-1 rounded-lg p-5" style={CARD}>
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <span className={UPLABEL} style={{ color: 'var(--ds-muted)' }}>Apply Rate % (applicants / views)</span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: `${C.blue}22`, color: C.blue }}>avg {f1(avgApply)}%</span>
              </div>
              <ResponsiveContainer width="100%" height={165}>
                <LineChart data={rateData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: C.dim, fontSize: 10.5, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: C.dim, fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} width={52} tickFormatter={v => f1(v) + '%'} />
                  <Tooltip content={<ChartTooltip pctMode />} />
                  <ReferenceLine y={avgApply} stroke={C.blue} strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Line type="monotone" dataKey="applyRate" name="Apply Rate" stroke={C.blue} strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Relevance rate */}
            <div className="flex-1 rounded-lg p-5" style={CARD}>
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <span className={UPLABEL} style={{ color: 'var(--ds-muted)' }}>Relevance Rate % (relevant / applicants)</span>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ background: `${C.amber}22`, color: C.amber }}>avg {f1(avgRel)}%</span>
              </div>
              <ResponsiveContainer width="100%" height={165}>
                <LineChart data={rateData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                  <XAxis dataKey="label" tick={{ fill: C.dim, fontSize: 10.5, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: C.dim, fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} width={52} tickFormatter={v => f1(v) + '%'} />
                  <Tooltip content={<ChartTooltip pctMode />} />
                  <ReferenceLine y={avgRel} stroke={C.amber} strokeDasharray="4 4" strokeOpacity={0.5} />
                  <Line type="monotone" dataKey="relevanceRate" name="Relevance Rate" stroke={C.amber} strokeWidth={2} dot connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* By Keyword section */}
          <div>
            <h2 className={`${UPLABEL} mb-3`} style={{ color: 'var(--ds-muted)' }}>By Job Title Keyword</h2>
            <div className="rounded-lg p-5 mb-3" style={CARD}>
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <span className={UPLABEL} style={{ color: 'var(--ds-muted)' }}>Applicants by keyword group</span>
                <div className="flex gap-4 font-mono text-[11px]" style={{ color: C.muted }}>
                  {[{ label: 'Applicants', color: C.blue }, { label: 'Relevant', color: C.greenL }, { label: 'Relevance %', color: C.amber }].map(l => (
                    <span key={l.label} className="flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: l.color, opacity: 0.85 }} />
                      {l.label}
                    </span>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <ComposedChart data={keywordAggs} margin={{ top: 4, right: 16, bottom: 4, left: 0 }} barGap={4} barCategoryGap="28%">
                  <XAxis dataKey="label" tick={{ fill: C.dim, fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="count" tick={{ fill: C.dim, fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} width={38} />
                  <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: C.amber, fontSize: 10, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar yAxisId="count" dataKey="applicants" name="Applicants" fill={C.blue}   radius={[3, 3, 0, 0]} opacity={0.85} />
                  <Bar yAxisId="count" dataKey="relevant"   name="Relevant"   fill={C.greenL} radius={[3, 3, 0, 0]} opacity={0.85} />
                  <Line yAxisId="pct" dataKey="relRate" name="Relevance %" stroke="transparent" isAnimationActive={false} dot={{ r: 4, fill: C.amber, stroke: C.amber }} activeDot={{ r: 5 }} legendType="circle" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {keywordAggs.map((kw, i) => {
                const col = KW_PALETTE[i % KW_PALETTE.length]
                const maxApps = Math.max(...keywordAggs.map(k => k.applicants), 1)
                return (
                  <div key={kw.label} className="rounded-lg p-4" style={CARD}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                        <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>{kw.label}</span>
                      </div>
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(55,138,221,0.15)', color: C.blue }}>
                        {kw.posts} post{kw.posts !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mb-3">
                      {[
                        { lab: 'Applicants',    val: kw.applicants.toLocaleString(),                       color: 'var(--ds-text)' },
                        { lab: 'Relevant',      val: kw.relevant > 0 ? kw.relevant.toLocaleString() : '—', color: 'var(--ds-text)' },
                        { lab: 'Apply Rate',    val: f1(kw.applyRate) + '%',                                color: rateColor(kw.applyRate) },
                        { lab: 'Rel. Rate',     val: kw.relRate > 0 ? f1(kw.relRate) + '%' : '—',           color: kw.relRate > 0 ? rateColor(kw.relRate) : C.dim },
                        { lab: 'Total Views',   val: kw.views.toLocaleString(),                             color: 'var(--ds-text)' },
                        { lab: 'Avg Days Live', val: kw.avgDuration > 0 ? f1(kw.avgDuration) : '—',        color: 'var(--ds-text)' },
                      ].map(s => (
                        <div key={s.lab}>
                          <span className="font-mono text-[10px] block mb-0.5" style={{ color: C.dim }}>{s.lab}</span>
                          <span className="font-mono text-base font-medium" style={{ color: s.color }}>{s.val}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[10px]" style={{ color: C.dim }}>Share of applicants</span>
                        <span className="font-mono text-[10px]" style={{ color: C.dim }}>{f1((kw.applicants / maxApps) * 100)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${(kw.applicants / maxApps) * 100}%`, background: col, opacity: 0.85 }} />
                      </div>
                    </div>
                    <details>
                      <summary className="font-mono text-[10px] cursor-pointer select-none" style={{ color: C.dim }}>
                        {kw.titlesUsed.length} title variant{kw.titlesUsed.length !== 1 ? 's' : ''} used
                      </summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {kw.titlesUsed.map(t => (
                          <li key={t} className="font-mono text-[10px] pl-2" style={{ color: C.muted, borderLeft: `2px solid ${col}44` }}>{t}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Per-poster cards */}
          <div>
            <h2 className={`${UPLABEL} mb-3`} style={{ color: 'var(--ds-muted)' }}>Per-Poster Performance</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agg.posters.map((p) => {
                const col = posterColorMap[p.name] ?? C.muted
                const series = posterMonthlySeries(p.name, 'applicants')
                return (
                  <div key={p.name} className="rounded-lg p-4" style={CARD}>
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>{p.name}</span>
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(55,138,221,0.15)', color: C.blue }}>
                        {p.posts} post{p.posts !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      {[
                        { lab: 'Total Views',      val: p.views.toLocaleString(),      color: 'var(--ds-text)' },
                        { lab: 'Total Applicants', val: p.applicants.toLocaleString(), color: 'var(--ds-text)' },
                        { lab: 'Apply Rate',       val: f1(p.applyRate) + '%',         color: rateColor(p.applyRate) },
                        { lab: 'Avg Days Live',    val: f1(p.avgDur),                  color: 'var(--ds-text)' },
                      ].map(s => (
                        <div key={s.lab}>
                          <span className="font-mono text-[11px] block mb-0.5" style={{ color: 'var(--ds-dim)' }}>{s.lab}</span>
                          <span className="font-mono text-lg font-medium" style={{ color: s.color }}>{s.val}</span>
                        </div>
                      ))}
                    </div>
                    <span className="font-mono text-[11px] block mb-1" style={{ color: 'var(--ds-dim)' }}>Applicants by month</span>
                    <SparkBars values={series.length ? series : [0]} color={col} height={40} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detail table */}
          <div>
            <h2 className={`${UPLABEL} mb-3`} style={{ color: 'var(--ds-muted)' }}>Posting Detail</h2>

            {/* Poster filter tabs */}
            <div className="flex items-center gap-1 flex-wrap mb-4">
              {['all', ...posterNames].map((v, i) => {
                const active = effectivePoster === v
                return (
                  <>
                    {i === 1 && <span key="div" className="w-px h-5 shrink-0" style={{ background: 'var(--ds-border)', margin: '0 4px' }} />}
                    <button
                      key={v}
                      onClick={() => setDetailPoster(v)}
                      className="font-mono text-[11px] px-3 py-1.5 rounded-md transition-all capitalize whitespace-nowrap"
                      style={{
                        background: active ? C.blue : 'var(--ds-surface)',
                        color: active ? '#fff' : C.muted,
                        border: `1px solid ${active ? C.blue : 'var(--ds-border)'}`,
                      }}
                    >
                      {v === 'all' ? 'All Posters' : v}
                    </button>
                  </>
                )
              })}
            </div>

            {/* Summary tiles */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { lab: 'Posts',       val: summaryRows.length.toLocaleString() },
                { lab: 'Total Views', val: sumViews.toLocaleString() },
                { lab: 'Applicants',  val: sumApps.toLocaleString() },
                { lab: 'Apply Rate',  val: f1(pct(sumApps, sumViews)) + '%' },
              ].map(s => (
                <div key={s.lab} className="rounded-lg px-4 py-3" style={CARD}>
                  <span className="font-mono text-[11px] block mb-1" style={{ color: 'var(--ds-muted)' }}>{s.lab}</span>
                  <span className="font-mono text-xl font-medium" style={{ color: 'var(--ds-text)' }}>{s.val}</span>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="rounded-lg overflow-auto" style={CARD}>
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
                    {([
                      { k: 'date',      label: 'Date' },
                      { k: 'poster',    label: 'Poster' },
                      { k: 'title',     label: 'Title' },
                      { k: 'views',     label: 'Views' },
                      { k: 'applicants',label: 'Applicants' },
                      { k: 'apply',     label: 'Apply %' },
                      { k: 'relevant',  label: 'Relevant' },
                      { k: 'relRate',   label: 'Rel. Rate' },
                      { k: 'duration',  label: 'Days' },
                      { k: 'role',      label: 'Role' },
                    ] as { k: SortKey; label: string }[]).map(col => (
                      <th
                        key={col.k}
                        onClick={() => handleSort(col.k)}
                        className="font-mono text-[11px] uppercase px-3.5 py-3 whitespace-nowrap select-none cursor-pointer"
                        style={{ color: sortKey === col.k ? 'var(--ds-muted)' : 'var(--ds-dim)' }}
                      >
                        {col.label}<SortArrow k={col.k} />
                      </th>
                    ))}
                    {admin && <th className="font-mono text-[11px] uppercase px-3.5 py-3 whitespace-nowrap text-right" style={{ color: 'var(--ds-dim)' }}>Edit</th>}
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((r, i) => {
                    const apply = r.views ? pct(r.applicants ?? 0, r.views) : null
                    return (
                      <tr
                        key={r.id ?? `row-${i}`}
                        style={{ borderBottom: '1px solid var(--ds-border)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.025)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = '' }}
                      >
                        <td className="font-mono text-xs px-3.5 py-2.5 whitespace-nowrap" style={{ color: 'var(--ds-text)' }}>{fmtDateShort(r.date)}</td>
                        <td className="font-mono text-xs px-3.5 py-2.5 whitespace-nowrap font-medium" style={{ color: posterColorMap[r.poster] ?? C.muted }}>{r.poster}</td>
                        <td className="text-[13px] px-3.5 py-2.5" style={{ color: 'var(--ds-text)', minWidth: 200, maxWidth: 280 }}>
                          {r.title || '—'}
                          {r.note && (
                            <span className="ml-1 text-[11px]" style={{ color: C.dim }} title={r.note}>●</span>
                          )}
                        </td>
                        <td className="font-mono text-xs px-3.5 py-2.5" style={{ color: 'var(--ds-text)' }}>{r.views?.toLocaleString() ?? '—'}</td>
                        <td className="font-mono text-xs px-3.5 py-2.5" style={{ color: 'var(--ds-text)' }}>{r.applicants?.toLocaleString() ?? '—'}</td>
                        <td className="font-mono text-xs px-3.5 py-2.5 font-medium" style={{ color: apply != null ? rateColor(apply) : 'var(--ds-dim)' }}>
                          {apply != null ? f1(apply) + '%' : '—'}
                        </td>
                        <td className="font-mono text-xs px-3.5 py-2.5" style={{ color: r.relevant != null ? 'var(--ds-text)' : 'var(--ds-dim)' }}>
                          {r.relevant != null ? r.relevant.toLocaleString() : '—'}
                        </td>
                        {(() => {
                          const rel = r.applicants && r.relevant != null ? pct(r.relevant, r.applicants) : null
                          return (
                            <td className="font-mono text-xs px-3.5 py-2.5 font-medium" style={{ color: rel != null ? rateColor(rel) : 'var(--ds-dim)' }}>
                              {rel != null ? f1(rel) + '%' : '—'}
                            </td>
                          )
                        })()}
                        <td className="font-mono text-xs px-3.5 py-2.5" style={{ color: 'var(--ds-text)' }}>{r.duration != null ? f1(r.duration) : '—'}</td>
                        <td className="font-mono text-xs px-3.5 py-2.5 whitespace-nowrap" style={{ color: r.role ? 'var(--ds-text)' : 'var(--ds-dim)' }}>
                          {r.role || '—'}
                          {r.paid && <span className="font-mono text-[10px] px-1.5 py-0.5 rounded ml-1.5" style={{ background: 'rgba(163,113,247,0.16)', color: '#a371f7' }}>paid</span>}
                        </td>
                        {admin && (
                          <td className="px-3.5 py-2.5 whitespace-nowrap text-right">
                            <button onClick={() => setEditing(r)} title="Edit" className="font-mono text-[11px] px-1.5" style={{ color: C.blue, cursor: 'pointer' }}>edit</button>
                            <button onClick={() => r.id != null && handleDelete(r.id)} title="Delete" className="font-mono text-[11px] px-1.5" style={{ color: '#f87171', cursor: 'pointer' }}>del</button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="font-mono text-[11px] mt-4 leading-relaxed" style={{ color: C.dim }}>
              Funnel: <span style={{ color: C.muted }}>Views → Applicants → Relevant</span>.{' '}
              &ldquo;Relevant&rdquo; was tracked inconsistently; relevance rates use only posts where it was measured.
            </p>
          </div>
        </>
      )}

      {editing && (
        <PostingForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { await globalMutate(POSTINGS_KEY); setEditing(null) }}
        />
      )}
    </div>
  )
}

// ── Add / edit posting form (modal) ──────────────────────────────────────────────
const PLATFORMS = ['LinkedIn', 'Jazz', 'Indeed', 'Other']

function PostingForm({ initial, onClose, onSaved }: {
  initial: Row | null
  onClose: () => void
  onSaved: () => void
}) {
  const [f, setF] = useState({
    poster: initial?.poster ?? '',
    date_posted: initial?.date ?? '',
    title: initial?.title ?? '',
    views: initial?.views ?? '',
    applicants: initial?.applicants ?? '',
    relevant: initial?.relevant ?? '',
    duration_days: initial?.duration ?? '',
    role: initial?.role ?? '',
    platform: initial?.platform && initial.platform !== 'Unspecified' ? initial.platform : 'LinkedIn',
    paid: initial?.paid ?? false,
    note: initial?.note ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | number | boolean) => setF(prev => ({ ...prev, [k]: v }))

  async function save() {
    // Posting date is required — rows without one are filtered out of the list & charts.
    if (!f.date_posted) { setErr('Date posted is required.'); return }
    setSaving(true); setErr(null)
    try {
      const editingExisting = initial?.id != null
      const res = await fetch(editingExisting ? `${POSTINGS_KEY}/${initial!.id}` : POSTINGS_KEY, {
        method: editingExisting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? 'Save failed'); return }
      onSaved()
    } catch {
      setErr('Save failed (network)')
    } finally {
      setSaving(false)
    }
  }

  const label = 'font-mono text-[11px] uppercase tracking-wider block mb-1'
  const input = 'w-full font-mono text-sm px-2.5 py-1.5 rounded-md outline-none'
  const inputStyle = { background: 'var(--ds-bg)', border: '1px solid var(--ds-border)', color: 'var(--ds-text)' } as const
  const num = (k: keyof typeof f, l: string) => (
    <div><span className={label} style={{ color: 'var(--ds-muted)' }}>{l}</span>
      <input type="number" value={f[k] as number | string} onChange={e => set(k, e.target.value)} className={input} style={inputStyle} /></div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg overflow-y-auto max-h-[90vh]" style={{ background: 'var(--ds-bg)', border: '1px solid var(--ds-border)' }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--ds-border)' }}>
          <span className="text-base font-medium" style={{ color: 'var(--ds-text)' }}>{initial?.id != null ? 'Edit posting' : 'Add posting'}</span>
          <button onClick={onClose} className="font-mono text-lg" style={{ color: 'var(--ds-muted)', cursor: 'pointer' }}>×</button>
        </div>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div className="col-span-2"><span className={label} style={{ color: 'var(--ds-muted)' }}>Title</span>
            <input value={f.title} onChange={e => set('title', e.target.value)} className={input} style={inputStyle} /></div>
          <div><span className={label} style={{ color: 'var(--ds-muted)' }}>Poster</span>
            <input value={f.poster} onChange={e => set('poster', e.target.value)} className={input} style={inputStyle} /></div>
          <div><span className={label} style={{ color: 'var(--ds-muted)' }}>Role</span>
            <input value={f.role} onChange={e => set('role', e.target.value)} className={input} style={inputStyle} /></div>
          <div><span className={label} style={{ color: 'var(--ds-muted)' }}>Date posted <span style={{ color: '#f87171' }}>*</span></span>
            <input type="date" required value={f.date_posted} onChange={e => set('date_posted', e.target.value)} className={input} style={{ ...inputStyle, borderColor: f.date_posted ? 'var(--ds-border)' : '#f8717166' }} /></div>
          <div><span className={label} style={{ color: 'var(--ds-muted)' }}>Duration (days)</span>
            <input type="number" value={f.duration_days} onChange={e => set('duration_days', e.target.value)} className={input} style={inputStyle} /></div>
          {num('views', 'Views')}
          {num('applicants', 'Applicants')}
          {num('relevant', 'Relevant')}
          <div><span className={label} style={{ color: 'var(--ds-muted)' }}>Channel</span>
            <select value={f.platform} onChange={e => set('platform', e.target.value)} className={input} style={inputStyle}>
              {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
            </select></div>
          <label className="flex items-center gap-2 mt-6 font-mono text-xs" style={{ color: 'var(--ds-text)' }}>
            <input type="checkbox" checked={f.paid} onChange={e => set('paid', e.target.checked)} /> Paid / promoted
          </label>
          <div className="col-span-2"><span className={label} style={{ color: 'var(--ds-muted)' }}>Note</span>
            <input value={f.note} onChange={e => set('note', e.target.value)} className={input} style={inputStyle} /></div>
        </div>
        {err && <p className="px-5 font-mono text-xs" style={{ color: '#f87171' }}>{err}</p>}
        <div className="px-5 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--ds-border)' }}>
          <button onClick={onClose} className="font-mono text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', color: 'var(--ds-muted)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving || !f.date_posted} className="font-mono text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--ds-green)', color: '#fff', border: '1px solid var(--ds-green)', opacity: !f.date_posted ? 0.5 : 1, cursor: saving ? 'wait' : !f.date_posted ? 'not-allowed' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
