'use client'

import { useState, useMemo, useEffect } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

// ── design tokens (match AshbyDashboard) ─────────────────────────────────────────
const C = {
  bg:      'var(--ds-bg)',
  surface: 'var(--ds-surface)',
  border:  'var(--ds-border)',
  text:    'var(--ds-text)',
  muted:   'var(--ds-muted)',
  dim:     'var(--ds-dim)',
  green:   'var(--ds-green)',
  greenL:  'var(--ds-green-light)',
  blue:    'var(--ds-blue)',
  amber:   'var(--ds-amber)',
  red:     '#f87171',
}
const CARD = { background: C.surface, border: `1px solid ${C.border}` }
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider'

// Ordered palette for funnel stages.
const STAGE_PALETTE = ['#8b949e', '#60a5fa', '#378add', '#3adea0', '#1a9e6e', '#c98a1a', '#a371f7', '#f472b6']

// ── types (mirror /api/ashby/pipeline) ───────────────────────────────────────────
interface Role {
  id: string
  title: string
  status: string | null
  department: string | null
  location: string | null
  employmentType: string | null
  openedAt: string | null
  daysOpen: number | null
  openings: number | null
  recruiter: string | null
  stages: Record<string, number>
  total: number
  relevant: number
  oldestActiveDays: number | null
  idleDays: number | null
  newThisWeek: number
  topSource: string | null
  owners: { name: string; count: number }[]
  stalled: boolean
  // Closed-role outcome fields (present when view === 'closed').
  hired?: number
  archived?: number
  topArchiveReason?: string | null
}
interface Totals {
  // open view
  openRoles?: number
  activeCandidates?: number
  relevant: number
  stalled?: number
  // closed view
  closedRoles?: number
  totalApplicants?: number
  hired?: number
  archived?: number
}
interface PipelineResponse {
  configured: boolean
  view?: 'open' | 'closed'
  generatedAt?: string
  stageOrder?: string[]
  totals?: Totals | null
  roles?: Role[]
  error?: string
}

// ── types (mirror /api/ashby/job/[id]) ────────────────────────────────────────────
interface CandidateRow {
  applicationId: string
  name: string
  stage: { title: string; type: string | null } | null
  status: string | null
  appliedAt: string | null
  daysInPipeline: number | null
  daysSinceActivity: number | null
  source: string | null
}

// ── types (mirror /api/ashby/job/[id]/analysis) ────────────────────────────────────
interface SourceAgg {
  source: string
  total: number
  hired: number
  advanced: number
  early: number
  archived: number
}
interface AnalysisResponse {
  configured: boolean
  totalApplicants?: number
  sourceBreakdown?: SourceAgg[]
  archiveReasons?: { reason: string; count: number }[]
  stageTiming?: Record<string, number | null>
  error?: string
}

const SOURCE_PALETTE = ['#60a5fa', '#3adea0', '#c98a1a', '#a371f7', '#f472b6', '#378add', '#1a9e6e', '#fb923c', '#8b949e']
interface StageGroup {
  stage: string
  type: string | null
  relevant: boolean
  count: number
  candidates: CandidateRow[]
}
interface JobDetailResponse {
  configured: boolean
  job: Role | null
  stages?: StageGroup[]
  total?: number
  relevant?: number
  oldestActiveDays?: number | null
  stalled?: boolean
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function f0(n: number) { return n.toLocaleString() }

// ── funnel bar ───────────────────────────────────────────────────────────────────
function FunnelBar({ stages, order, colorMap }: {
  stages: Record<string, number>; order: string[]; colorMap: Record<string, string>
}) {
  const present = order.filter((s) => (stages[s] ?? 0) > 0)
  const total = present.reduce((s, k) => s + stages[k], 0)
  if (!total) {
    return <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }} />
  }
  return (
    <div className="flex h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
      {present.map((s) => (
        <div
          key={s}
          title={`${s}: ${stages[s]}`}
          style={{ width: `${(stages[s] / total) * 100}%`, background: colorMap[s] ?? C.muted, opacity: 0.85 }}
        />
      ))}
    </div>
  )
}

// ── not-configured state ──────────────────────────────────────────────────────────
function NotConfigured() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-2xl font-medium" style={{ color: C.text }}>Pipeline</h2>
        <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
          Open roles &amp; candidate stage funnel — live from Ashby
        </p>
      </div>
      <div className="rounded-lg p-8 flex flex-col items-center text-center gap-4" style={CARD}>
        <div
          className="flex items-center justify-center rounded-full"
          style={{ width: 48, height: 48, background: C.blue + '1a', border: `1px solid ${C.blue}44` }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <div>
          <p className="text-base font-medium" style={{ color: C.text }}>Connect Ashby to see your pipeline</p>
          <p className="mt-1.5 font-mono text-xs leading-relaxed max-w-md" style={{ color: C.muted }}>
            Set the <code style={{ color: C.greenL }}>ASHBY_API_KEY</code> environment variable, then redeploy.
            Once connected, this tab shows every open role with its live stage funnel, candidate counts,
            recruiter, and aging flags.
          </p>
        </div>
        <div className="rounded-md px-4 py-3 font-mono text-[11px] text-left leading-relaxed" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, color: C.dim }}>
          <div><span style={{ color: C.muted }}>1.</span> In Ashby: Settings → Integrations → API → generate a key</div>
          <div><span style={{ color: C.muted }}>2.</span> Add <span style={{ color: C.greenL }}>ASHBY_API_KEY=…</span> to <span style={{ color: C.text }}>.env.local</span> (or Vercel env)</div>
          <div><span style={{ color: C.muted }}>3.</span> Optional: <span style={{ color: C.greenL }}>ASHBY_INBOUND_JOB_ID=…</span> to scope Inbound weekly data</div>
        </div>
      </div>
    </div>
  )
}

// ── analysis: sources donut + source→outcome quality ───────────────────────────────
const OUTCOME = [
  { key: 'hired', label: 'Hired', color: '#1a9e6e' },
  { key: 'advanced', label: 'Advanced', color: '#3adea0' },
  { key: 'early', label: 'In review', color: '#60a5fa' },
  { key: 'archived', label: 'Archived', color: '#484f58' },
] as const

function SourcesSection({ analysis }: { analysis: AnalysisResponse | undefined }) {
  const sources = analysis?.sourceBreakdown ?? []
  const loading = !analysis

  // Donut: top 8 by volume, rest folded into "Other".
  const donut = useMemo(() => {
    if (!sources.length) return [] as { source: string; total: number }[]
    const top = sources.slice(0, 8).map((s) => ({ source: s.source, total: s.total }))
    const rest = sources.slice(8).reduce((sum, s) => sum + s.total, 0)
    return rest > 0 ? [...top, { source: 'Other', total: rest }] : top
  }, [sources])

  const totalApplicants = analysis?.totalApplicants ?? sources.reduce((s, r) => s + r.total, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.text }}>Sources</span>
        <span className="font-mono text-[11px]" style={{ color: C.dim }}>
          {loading ? 'analyzing…' : `${f0(totalApplicants)} applicants all-time`}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 rounded-lg font-mono text-xs" style={{ ...CARD, color: C.muted }}>
          Analyzing source mix &amp; outcomes…
        </div>
      ) : sources.length === 0 ? (
        <div className="flex items-center justify-center h-24 rounded-lg font-mono text-xs" style={{ ...CARD, color: C.muted }}>No applicants found.</div>
      ) : (
        <div className="rounded-lg p-4 flex flex-col gap-4" style={CARD}>
          {/* Donut + legend */}
          <div className="flex items-center gap-4 flex-wrap">
            <div style={{ width: 132, height: 132 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="total" nameKey="source" innerRadius={38} outerRadius={62} paddingAngle={2} stroke="none">
                    {donut.map((d, i) => <Cell key={d.source} fill={SOURCE_PALETTE[i % SOURCE_PALETTE.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1c2333', border: `1px solid ${C.border}`, borderRadius: 8, fontFamily: 'monospace', fontSize: 11 }}
                    itemStyle={{ color: C.text }} labelStyle={{ color: C.muted }}
                    formatter={(v: number, n: string) => [`${v} (${((v / totalApplicants) * 100).toFixed(0)}%)`, n]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 min-w-[140px] flex flex-col gap-1">
              {donut.map((d, i) => (
                <div key={d.source} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: SOURCE_PALETTE[i % SOURCE_PALETTE.length] }} />
                  <span className="truncate" style={{ color: C.muted }}>{d.source}</span>
                  <span className="ml-auto" style={{ color: C.text }}>{d.total}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Source → outcome (which channels advance) */}
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: C.muted }}>Which sources advance</span>
              <div className="flex items-center gap-2.5 font-mono text-[9px]" style={{ color: C.dim }}>
                {OUTCOME.map((o) => (
                  <span key={o.key} className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: o.color }} />{o.label}</span>
                ))}
              </div>
            </div>
            {sources.slice(0, 8).map((s) => {
              const advanceRate = s.total > 0 ? ((s.hired + s.advanced) / s.total) * 100 : 0
              return (
                <div key={s.source} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] w-32 shrink-0 truncate" style={{ color: C.text }} title={s.source}>{s.source}</span>
                  <div className="flex-1 flex h-3 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {OUTCOME.map((o) => {
                      const val = s[o.key]
                      return val > 0 ? <div key={o.key} title={`${o.label}: ${val}`} style={{ width: `${(val / s.total) * 100}%`, background: o.color }} /> : null
                    })}
                  </div>
                  <span className="font-mono text-[10px] w-16 text-right shrink-0" style={{ color: advanceRate >= 15 ? C.greenL : advanceRate > 0 ? C.muted : C.dim }}>
                    {s.hired > 0 ? `${s.hired} hire${s.hired > 1 ? 's' : ''}` : `${advanceRate.toFixed(0)}% adv`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function RejectionsSection({ analysis }: { analysis: AnalysisResponse | undefined }) {
  const reasons = analysis?.archiveReasons ?? []
  if (!analysis) return null
  if (!reasons.length) return null
  const max = Math.max(...reasons.map((r) => r.count), 1)
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.text }}>Why candidates were archived</span>
      <div className="rounded-lg p-4 flex flex-col gap-1.5" style={CARD}>
        {reasons.slice(0, 10).map((r) => (
          <div key={r.reason} className="flex items-center gap-2">
            <span className="font-mono text-[11px] w-40 shrink-0 truncate" style={{ color: C.muted }} title={r.reason}>{r.reason}</span>
            <div className="flex-1 h-3 rounded overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="h-full rounded" style={{ width: `${(r.count / max) * 100}%`, background: C.red, opacity: 0.7 }} />
            </div>
            <span className="font-mono text-[10px] w-8 text-right shrink-0" style={{ color: C.muted }}>{r.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── role detail drawer ────────────────────────────────────────────────────────────
function RoleDetailDrawer({ roleId, fallback, colorMap, closed, onClose }: {
  roleId: string
  fallback: Role
  colorMap: Record<string, string>
  closed: boolean
  onClose: () => void
}) {
  const { data, isLoading } = useSWR<JobDetailResponse>(`/api/ashby/job/${roleId}`, fetcher)
  // Heavier analytics load separately so the candidate list isn't blocked on them.
  const { data: analysis } = useSWR<AnalysisResponse>(`/api/ashby/job/${roleId}/analysis`, fetcher)

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const job = data?.job ?? fallback
  const stages = data?.stages ?? []
  const total = data?.total ?? fallback.total
  const relevant = data?.relevant ?? fallback.relevant

  function ageColor(d: number | null): string {
    if (d === null) return C.dim
    if (d > 30) return C.amber
    if (d > 14) return C.muted
    return C.dim
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto"
        style={{ background: C.bg, borderLeft: `1px solid ${C.border}`, boxShadow: '-8px 0 32px rgba(0,0,0,0.4)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 px-6 py-5" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-medium" style={{ color: C.text }}>{job.title}</h3>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {[job.department, job.location, job.employmentType].filter(Boolean).map((chip, i) => (
                  <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: C.muted }}>{chip}</span>
                ))}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex items-center justify-center rounded-lg shrink-0"
              style={{ width: 30, height: 30, background: C.surface, border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="mt-4 flex items-center gap-6">
            {closed ? (
              <>
                <div><span className="text-xl font-medium" style={{ color: C.blue }}>{analysis?.totalApplicants ?? fallback.total}</span><span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>applicants</span></div>
                <div><span className="text-xl font-medium" style={{ color: C.greenL }}>{fallback.hired ?? 0}</span><span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>hired</span></div>
                <div><span className="text-xl font-medium" style={{ color: C.muted }}>{fallback.archived ?? 0}</span><span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>archived</span></div>
                <div className="ml-auto font-mono text-[11px]" style={{ color: C.dim }}>
                  {job.recruiter ? `Recruiter · ${job.recruiter} · ` : ''}{job.status ?? 'Closed'}
                </div>
              </>
            ) : (
              <>
                <div><span className="text-xl font-medium" style={{ color: C.blue }}>{total}</span><span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>active</span></div>
                <div><span className="text-xl font-medium" style={{ color: C.greenL }}>{relevant}</span><span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>relevant</span></div>
                <div className="ml-auto font-mono text-[11px]" style={{ color: C.dim }}>
                  {job.recruiter ? `Recruiter · ${job.recruiter}` : ''}{job.daysOpen !== null ? ` · Open ${job.daysOpen}d` : ''}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-6">
          {/* Full-funnel analytics (stream in) */}
          <SourcesSection analysis={analysis} />
          <RejectionsSection analysis={analysis} />

          {/* Active pipeline */}
          <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.text }}>Active pipeline</span>
          {isLoading && !data && (
            <div className="flex items-center justify-center h-40 font-mono text-sm" style={{ color: C.muted }}>Loading candidates…</div>
          )}
          {data?.error && (
            <div className="font-mono text-sm" style={{ color: C.red }}>Failed to load candidates. <span style={{ color: C.dim }}>{data.error}</span></div>
          )}
          {!isLoading && !data?.error && stages.length === 0 && (
            <div className="flex items-center justify-center h-40 font-mono text-sm rounded-lg" style={{ ...CARD, color: C.muted }}>No active candidates in this pipeline.</div>
          )}
          {stages.map((group) => {
            const col = colorMap[group.stage] ?? C.muted
            return (
              <div key={group.stage} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: col }} />
                  <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: C.text }}>{group.stage}</span>
                  <span className="font-mono text-[11px]" style={{ color: C.dim }}>{group.count}</span>
                  {group.relevant && <span className="font-mono text-[9px] px-1 py-0.5 rounded" style={{ background: C.greenL + '22', color: C.greenL }}>relevant</span>}
                </div>
                <div className="rounded-lg overflow-hidden" style={CARD}>
                  {group.candidates.map((c, i) => {
                    const inStage = analysis?.stageTiming?.[c.applicationId]
                    const hasInStage = inStage !== undefined && inStage !== null
                    const metric = hasInStage ? inStage : c.daysSinceActivity
                    const metricLabel = hasInStage ? 'in stage' : 'since activity'
                    return (
                      <div
                        key={c.applicationId}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                        style={{ borderBottom: i < group.candidates.length - 1 ? `1px solid ${C.border}` : 'none' }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm truncate" style={{ color: C.text }}>{c.name}</p>
                          {c.source && <p className="font-mono text-[10px] truncate" style={{ color: C.dim }}>via {c.source}</p>}
                        </div>
                        <span className="font-mono text-[11px] whitespace-nowrap text-right" style={{ color: ageColor(metric) }}>
                          {metric !== null ? `${metric}d ${metricLabel}` : '—'}
                          {c.daysInPipeline !== null && (
                            <span className="block text-[9px]" style={{ color: C.dim }}>{c.daysInPipeline}d total</span>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── sort ──────────────────────────────────────────────────────────────────────────
type SortKey = 'title' | 'total' | 'relevant' | 'newThisWeek' | 'daysOpen' | 'idleDays' | 'hired' | 'archived'

// ── main ────────────────────────────────────────────────────────────────────────────
export function PipelineDashboard() {
  const [view, setView] = useState<'open' | 'closed'>('open')
  const swrKey = `/api/ashby/pipeline${view === 'closed' ? '?status=closed' : ''}`
  const { data, isLoading, error } = useSWR<PipelineResponse>(swrKey, fetcher, { refreshInterval: 300_000 })
  const [refreshing, setRefreshing] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const closed = view === 'closed'

  async function handleRefresh() {
    setRefreshing(true)
    await globalMutate(swrKey)
    setRefreshing(false)
  }

  const roles = data?.roles ?? []
  const stageOrder = data?.stageOrder ?? []
  const totals = data?.totals ?? null

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {}
    stageOrder.forEach((s, i) => { m[s] = STAGE_PALETTE[i % STAGE_PALETTE.length] })
    return m
  }, [stageOrder])

  const sortedRoles = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...roles].sort((a, b) => {
      if (sortKey === 'title') return a.title.localeCompare(b.title) * dir
      const av = (a[sortKey] as number | null) ?? -Infinity
      const bv = (b[sortKey] as number | null) ?? -Infinity
      return (av - bv) * dir
    })
  }, [roles, sortKey, sortDir])

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'title' ? 'asc' : 'desc') }
  }

  const SortArrow = ({ k }: { k: SortKey }) => (
    <span className="opacity-50 text-[9px] ml-0.5">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
  )

  if (isLoading) return (
    <div className="flex items-center justify-center h-64 font-mono text-sm" style={{ color: C.muted }}>
      Loading pipeline…
    </div>
  )
  if (data && data.configured === false) return <NotConfigured />
  if (error || data?.error) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 font-mono text-sm" style={{ color: C.red }}>
      <span>Failed to load pipeline.</span>
      {data?.error && <span className="text-xs" style={{ color: C.dim }}>{data.error}</span>}
    </div>
  )

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-medium" style={{ color: C.text }}>Pipeline</h2>
          <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
            {closed
              ? `${roles.length} closed role${roles.length === 1 ? '' : 's'} — post-hoc source & rejection analysis`
              : `${roles.length} open role${roles.length === 1 ? '' : 's'} — live candidate stage funnel from Ashby`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Open / Closed toggle */}
          <div className="flex gap-0 p-1 rounded-lg" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            {(['open', 'closed'] as const).map((v) => (
              <button
                key={v}
                onClick={() => { setView(v); setSortKey('total'); setSortDir('desc'); setSelectedRoleId(null) }}
                className="font-mono text-xs px-3 py-1.5 rounded-md transition-all capitalize"
                style={{
                  background: view === v ? C.blue + '22' : 'none',
                  color: view === v ? C.blue : C.muted,
                  border: view === v ? `1px solid ${C.blue}44` : '1px solid transparent',
                }}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh from Ashby"
            className="flex items-center justify-center rounded-lg transition-all"
            style={{ width: 34, height: 34, background: C.surface, border: `1px solid ${C.border}`, color: refreshing ? C.dim : C.muted, cursor: refreshing ? 'not-allowed' : 'pointer', flexShrink: 0 }}
          >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: refreshing ? 'rotate(360deg)' : 'none', transition: refreshing ? 'transform 0.8s linear' : 'none' }}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          </button>
        </div>
      </div>

      {/* KPI strip */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(closed
            ? [
                { label: 'Closed Roles',    value: f0(totals.closedRoles ?? 0),    color: C.text },
                { label: 'Total Applicants', value: f0(totals.totalApplicants ?? 0), color: C.blue },
                { label: 'Hired',           value: f0(totals.hired ?? 0),          color: C.greenL },
                { label: 'Archived',        value: f0(totals.archived ?? 0),       color: C.muted },
              ]
            : [
                { label: 'Open Roles',        value: f0(totals.openRoles ?? 0),       color: C.text },
                { label: 'Active Candidates', value: f0(totals.activeCandidates ?? 0), color: C.blue },
                { label: 'Relevant',          value: f0(totals.relevant ?? 0),        color: C.greenL },
                { label: 'Stalled Roles',     value: f0(totals.stalled ?? 0),         color: (totals.stalled ?? 0) > 0 ? C.amber : C.muted },
              ]
          ).map((kpi) => (
            <div key={kpi.label} className="rounded-lg p-5 flex flex-col gap-3" style={CARD}>
              <span className={UPLABEL} style={{ color: C.muted }}>{kpi.label}</span>
              <span className="text-3xl font-medium leading-none" style={{ color: kpi.color }}>{kpi.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stage legend */}
      {stageOrder.length > 0 && (
        <div className="flex items-center gap-x-4 gap-y-2 flex-wrap font-mono text-[11px]" style={{ color: C.dim }}>
          {stageOrder.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colorMap[s], opacity: 0.85 }} />
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Role cards */}
      {roles.length === 0 ? (
        <div className="flex items-center justify-center h-40 font-mono text-sm rounded-lg" style={{ ...CARD, color: C.muted }}>
          {closed ? 'No closed roles found in Ashby.' : 'No open roles found in Ashby.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedRoles.map((role) => (
            <div
              key={role.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedRoleId(role.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedRoleId(role.id) } }}
              className="rounded-lg p-5 flex flex-col gap-4 transition-colors cursor-pointer outline-none"
              style={CARD}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.blue + '66' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-medium truncate" style={{ color: C.text }}>{role.title}</p>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {[role.department, role.location, role.employmentType].filter(Boolean).map((chip, i) => (
                      <span key={i} className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: C.muted }}>{chip}</span>
                    ))}
                  </div>
                </div>
                {closed ? (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: 'rgba(255,255,255,0.05)', color: C.muted, border: `1px solid ${C.border}` }}>
                    {role.status ?? 'Closed'}
                  </span>
                ) : role.stalled && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: C.amber + '22', color: C.amber, border: `1px solid ${C.amber}44` }}>
                    idle {role.idleDays}d
                  </span>
                )}
              </div>

              {closed ? (
                <>
                  {/* Outcome counts */}
                  <div className="flex items-center gap-6">
                    <div>
                      <span className="text-2xl font-medium leading-none" style={{ color: C.blue }}>{role.total}</span>
                      <span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>applicants</span>
                    </div>
                    <div>
                      <span className="text-2xl font-medium leading-none" style={{ color: C.greenL }}>{role.hired ?? 0}</span>
                      <span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>hired</span>
                    </div>
                    <div>
                      <span className="text-2xl font-medium leading-none" style={{ color: C.muted }}>{role.archived ?? 0}</span>
                      <span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>archived</span>
                    </div>
                    <span className="ml-auto font-mono text-[11px] whitespace-nowrap" style={{ color: C.blue }}>
                      View analysis →
                    </span>
                  </div>

                  {/* Insights */}
                  <div className="flex flex-col gap-1 font-mono text-[11px]" style={{ color: C.dim }}>
                    {role.topSource && <span>Top source <span style={{ color: C.text }}>{role.topSource}</span></span>}
                    {role.topArchiveReason && <span>Top rejection <span style={{ color: C.text }}>{role.topArchiveReason}</span></span>}
                    <span>Advanced past screen <span style={{ color: C.greenL }}>{role.relevant}</span></span>
                  </div>

                  {/* Footer meta */}
                  <div className="flex items-center justify-between font-mono text-[10px] pt-1" style={{ color: C.dim, borderTop: `1px solid ${C.border}` }}>
                    <span>{role.recruiter ? `Recruiter · ${role.recruiter}` : 'Recruiter · —'}</span>
                    <span>{role.openings ? `${role.openings} opening${role.openings === 1 ? '' : 's'}` : ''}</span>
                  </div>
                </>
              ) : (
                <>
                  {/* Counts */}
                  <div className="flex items-center gap-6">
                    <div>
                      <span className="text-2xl font-medium leading-none" style={{ color: C.blue }}>{role.total}</span>
                      <span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>active</span>
                    </div>
                    <div>
                      <span className="text-2xl font-medium leading-none" style={{ color: C.greenL }}>{role.relevant}</span>
                      <span className="ml-1.5 font-mono text-[11px]" style={{ color: C.dim }}>relevant</span>
                    </div>
                    <span className="ml-auto font-mono text-[11px] whitespace-nowrap" style={{ color: C.blue }}>
                      View candidates →
                    </span>
                  </div>

                  {/* Funnel */}
                  <FunnelBar stages={role.stages} order={stageOrder} colorMap={colorMap} />

                  {/* Stage counts inline */}
                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap font-mono text-[11px]" style={{ color: C.muted }}>
                    {stageOrder.filter((s) => (role.stages[s] ?? 0) > 0).map((s) => (
                      <span key={s} className="flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: colorMap[s] }} />
                        {s} <span style={{ color: C.text }}>{role.stages[s]}</span>
                      </span>
                    ))}
                    {role.total === 0 && <span style={{ color: C.dim }}>No active candidates</span>}
                  </div>

                  {/* Cheap-win stats */}
                  <div className="flex items-center gap-x-4 gap-y-1 flex-wrap font-mono text-[11px]" style={{ color: C.dim }}>
                    <span>New this week <span style={{ color: role.newThisWeek > 0 ? C.greenL : C.muted }}>{role.newThisWeek}</span></span>
                    {role.topSource && <span>Top source <span style={{ color: C.text }}>{role.topSource}</span></span>}
                    {role.idleDays !== null && (
                      <span>Last activity <span style={{ color: role.idleDays > 14 ? C.amber : C.muted }}>{role.idleDays}d ago</span></span>
                    )}
                  </div>

                  {/* Footer meta */}
                  <div className="flex items-center justify-between font-mono text-[10px] pt-1" style={{ color: C.dim, borderTop: `1px solid ${C.border}` }}>
                    <span>{role.recruiter ? `Recruiter · ${role.recruiter}` : 'Recruiter · —'}</span>
                    <span>{role.daysOpen !== null ? `Open ${role.daysOpen}d` : ''}{role.openings ? ` · ${role.openings} opening${role.openings === 1 ? '' : 's'}` : ''}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Roles table */}
      {roles.length > 0 && (
        <div className="rounded-lg overflow-hidden" style={CARD}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}` }}>
            <span className={UPLABEL} style={{ color: C.muted }}>{closed ? 'All Closed Roles' : 'All Open Roles'}</span>
            <span className="font-mono text-xs" style={{ color: C.dim }}>{roles.length} roles</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  {((closed
                    ? [
                        { k: 'title', label: 'Role' },
                        { k: 'total', label: 'Applicants' },
                        { k: 'hired', label: 'Hired' },
                        { k: 'archived', label: 'Archived' },
                        { k: 'relevant', label: 'Advanced' },
                      ]
                    : [
                        { k: 'title', label: 'Role' },
                        { k: 'total', label: 'Active' },
                        { k: 'relevant', label: 'Relevant' },
                        { k: 'newThisWeek', label: 'New 7d' },
                        { k: 'daysOpen', label: 'Days Open' },
                        { k: 'idleDays', label: 'Idle (d)' },
                      ]) as { k: SortKey; label: string }[]).map((col) => (
                    <th key={col.k} onClick={() => handleSort(col.k)}
                      className="px-5 py-3 text-left font-normal select-none cursor-pointer whitespace-nowrap"
                      style={{ color: sortKey === col.k ? C.muted : C.dim }}>
                      {col.label}<SortArrow k={col.k} />
                    </th>
                  ))}
                  <th className="px-5 py-3 text-left font-normal" style={{ color: C.dim }}>{closed ? 'Top source' : 'Recruiter'}</th>
                </tr>
              </thead>
              <tbody>
                {sortedRoles.map((role, i) => (
                  <tr
                    key={role.id}
                    onClick={() => setSelectedRoleId(role.id)}
                    className="cursor-pointer"
                    style={{ borderBottom: i < sortedRoles.length - 1 ? `1px solid ${C.border}` : 'none' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '' }}
                  >
                    <td className="px-5 py-3" style={{ color: C.text }}>
                      {role.title}
                      {!closed && role.stalled && <span className="ml-2 font-mono text-[10px] px-1 py-0.5 rounded" style={{ background: C.amber + '22', color: C.amber }}>stalled</span>}
                    </td>
                    {closed ? (
                      <>
                        <td className="px-5 py-3" style={{ color: C.blue }}>{role.total}</td>
                        <td className="px-5 py-3" style={{ color: C.greenL }}>{role.hired ?? 0}</td>
                        <td className="px-5 py-3" style={{ color: C.muted }}>{role.archived ?? 0}</td>
                        <td className="px-5 py-3" style={{ color: C.greenL }}>{role.relevant}</td>
                        <td className="px-5 py-3" style={{ color: C.muted }}>{role.topSource ?? '—'}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-5 py-3" style={{ color: C.blue }}>{role.total}</td>
                        <td className="px-5 py-3" style={{ color: C.greenL }}>{role.relevant}</td>
                        <td className="px-5 py-3" style={{ color: role.newThisWeek > 0 ? C.greenL : C.muted }}>{role.newThisWeek}</td>
                        <td className="px-5 py-3" style={{ color: C.muted }}>{role.daysOpen ?? '—'}</td>
                        <td className="px-5 py-3" style={{ color: role.stalled ? C.amber : C.muted }}>{role.idleDays ?? '—'}</td>
                        <td className="px-5 py-3" style={{ color: C.muted }}>{role.recruiter ?? '—'}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data?.generatedAt && (
        <p className="font-mono text-[11px]" style={{ color: C.dim }}>
          &ldquo;Relevant&rdquo; approximates candidates advanced past raw application review
          (recruiter-engaged or later). Data as of {new Date(data.generatedAt).toLocaleString()}.
        </p>
      )}

      {selectedRoleId && (() => {
        const selected = roles.find((r) => r.id === selectedRoleId)
        if (!selected) return null
        return (
          <RoleDetailDrawer
            roleId={selectedRoleId}
            fallback={selected}
            colorMap={colorMap}
            closed={closed}
            onClose={() => setSelectedRoleId(null)}
          />
        )
      })()}
    </div>
  )
}
