'use client'

import { useState } from 'react'
import useSWR from 'swr'

// Scorecard view on the Pipeline tab: what the 1-4 overall recommendations are worth, checked
// against how those candidates actually ended up. See lib/ashby-scorecards.ts for the two
// corrections that matter — per-candidate averaging, and stage-adjusted interviewer comparison.

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const C = {
  bg: 'var(--ds-bg)', surface: 'var(--ds-surface)', border: 'var(--ds-border)',
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green-light)', blue: 'var(--ds-blue)', amber: 'var(--ds-amber)', red: '#f87171',
}
const CARD = { background: C.surface, border: `1px solid ${C.border}` }
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider'
const RATING_LABEL: Record<string, string> = { '4': 'Strong yes', '3': 'Yes', '2': 'No', '1': 'Strong no' }
const scoreColor = (n: number) => (n >= 4 ? C.green : n === 3 ? C.blue : n === 2 ? C.amber : C.red)

interface StageStat { stage: string; n: number; avg: number; dist: Record<string, number> }
interface InterviewerStat { name: string; n: number; avg: number; vsStage: number | null; dist: Record<string, number>; topStage: string | null }
interface BandStat { band: number; apps: number; hired: number; archived: number; active: number; hireRate: number | null }
interface HireDetail {
  applicationId: string
  name: string
  role: string | null
  hiredAt: string | null
  avg: number
  count: number
  low: number
  high: number
  scores: { score: number; stage: string | null; interviewer: string; at: string | null }[]
}
interface Analytics {
  configured: boolean
  totals: {
    scorecards: number; applications: number; interviewers: number
    avgHired: number | null; avgArchived: number | null
    hiredCount: number; archivedCount: number; unresolvedStage: number
  }
  bands: BandStat[]
  stages: StageStat[]
  interviewers: InterviewerStat[]
  hires: HireDetail[]
  roles: { id: string; title: string; n: number }[]
  error?: string
}

// A 1-4 mix as a single stacked bar — the shape of someone's scoring in one glance.
function DistBar({ dist, total }: { dist: Record<string, number>; total: number }) {
  if (!total) return null
  return (
    <div className="flex h-2 rounded-sm overflow-hidden" style={{ width: 92, background: C.bg }}>
      {['4', '3', '2', '1'].map((k) => {
        const pct = ((dist[k] ?? 0) / total) * 100
        return pct > 0 ? (
          <div key={k} title={`${RATING_LABEL[k]}: ${dist[k]}`} style={{ width: `${pct}%`, background: scoreColor(Number(k)) }} />
        ) : null
      })}
    </div>
  )
}

const f1 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1))
const f2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2))
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—'

// One hire, expandable into every scorecard they collected in submission order.
function HireRow({ h, open, onToggle, last }: { h: HireDetail; open: boolean; onToggle: () => void; last: boolean }) {
  const unanimous = h.low === h.high
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer"
        style={{ borderBottom: open || !last ? `1px solid ${C.border}` : 'none' }}
      >
        <td className="px-4 py-2.5" style={{ color: C.text }}>
          <span style={{ color: C.dim }}>{open ? '▾' : '▸'}</span> {h.name}
        </td>
        <td className="px-4 py-2.5" style={{ color: C.dim }}>{h.role ?? '—'}</td>
        <td className="px-4 py-2.5 text-right" style={{ color: scoreColor(Math.round(h.avg)) }}>{f2(h.avg)}</td>
        <td className="px-4 py-2.5 text-right" style={{ color: C.muted }}>{h.count}</td>
        <td className="px-4 py-2.5 text-right" style={{ color: unanimous ? C.dim : C.amber }}>
          {unanimous ? `all ${h.low}` : `${h.low}–${h.high}`}
        </td>
        <td className="px-4 py-2.5 text-right whitespace-nowrap" style={{ color: C.muted }}>{day(h.hiredAt)}</td>
      </tr>
      {open && (
        <tr style={{ borderBottom: last ? 'none' : `1px solid ${C.border}` }}>
          <td colSpan={6} className="px-4 py-3" style={{ background: C.bg }}>
            <table className="w-full text-left font-mono text-[11px]">
              <tbody>
                {h.scores.map((s, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-4 whitespace-nowrap" style={{ color: scoreColor(s.score), width: 110 }}>
                      {s.score} <span style={{ color: C.dim }}>{RATING_LABEL[String(s.score)]}</span>
                    </td>
                    <td className="py-1 pr-4" style={{ color: C.text }}>{s.stage ?? <span style={{ color: C.dim }}>stage not matched</span>}</td>
                    <td className="py-1 pr-4" style={{ color: C.muted }}>{s.interviewer}</td>
                    <td className="py-1 text-right whitespace-nowrap" style={{ color: C.dim }}>{day(s.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

export function ScorecardAnalytics() {
  const [jobId, setJobId] = useState<string>('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { data, isLoading } = useSWR<Analytics>(
    `/api/ashby/scorecards${jobId ? `?jobId=${encodeURIComponent(jobId)}` : ''}`,
    fetcher, { refreshInterval: 300_000, keepPreviousData: true }
  )

  if (isLoading && !data) return (
    <div className="flex items-center justify-center h-64 font-mono text-sm" style={{ color: C.muted }}>Loading scorecards…</div>
  )
  if (data && (data.configured === false || data.error)) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 font-mono text-sm" style={{ color: C.muted }}>
      <span>No scorecard data available.</span>
      {data.error && <span className="text-xs" style={{ color: C.dim }}>{data.error}</span>}
    </div>
  )

  const t = data?.totals
  const spread = t?.avgHired != null && t?.avgArchived != null ? t.avgHired - t.avgArchived : null
  const maxStageN = Math.max(1, ...(data?.stages ?? []).map((s) => s.n))
  const allOpen = !!data?.hires?.length && expanded.size === data.hires.length

  const kpis = [
    { label: 'Scorecards', value: (t?.scorecards ?? 0).toLocaleString(), sub: `${t?.applications ?? 0} candidates · ${t?.interviewers ?? 0} interviewers`, color: C.text },
    { label: 'Avg score — hired', value: f1(t?.avgHired), sub: `${t?.hiredCount ?? 0} hired`, color: C.green },
    { label: 'Avg score — rejected', value: f1(t?.avgArchived), sub: `${t?.archivedCount ?? 0} archived`, color: C.amber },
    { label: 'Spread', value: spread == null ? '—' : `+${spread.toFixed(1)}`, sub: 'hired minus rejected', color: spread != null && spread >= 0.5 ? C.blue : C.dim },
  ]

  return (
    <div className="flex flex-col gap-8">
      {/* Role filter */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <span className={`${UPLABEL} block`} style={{ color: C.muted }}>Scorecards</span>
          <span className="font-mono text-[11px] mt-1 block" style={{ color: C.dim }}>
            Ashby overall recommendations, 4 = strong yes · read against how each candidate ended up
          </span>
        </div>
        <select
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          className="font-mono text-xs px-2.5 py-1.5 rounded-md outline-none"
          style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer', maxWidth: 320 }}
        >
          <option value="">All roles</option>
          {(data?.roles ?? []).map((r) => (
            <option key={r.id} value={r.id}>{r.title} ({r.n})</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="p-4 rounded-lg" style={CARD}>
            <span className={`${UPLABEL} block`} style={{ color: C.muted }}>{k.label}</span>
            <div className="font-mono text-[26px] leading-none font-medium mt-1.5" style={{ color: k.color }}>{k.value}</div>
            <span className="font-mono text-[10.5px] mt-1.5 block" style={{ color: C.dim }}>{k.sub}</span>
          </div>
        ))}
      </div>

      {/* Does the score predict the outcome? */}
      <div>
        <span className={`${UPLABEL} block mb-1`} style={{ color: C.muted }}>Outcome by score</span>
        <span className="font-mono text-[11px] block mb-3" style={{ color: C.dim }}>
          Candidates grouped by their average score across every scorecard they received
        </span>
        <div className="rounded-lg overflow-hidden" style={CARD}>
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Avg score</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Candidates</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hired</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Rejected</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Still active</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hire rate</th>
              </tr>
            </thead>
            <tbody>
              {[...(data?.bands ?? [])].reverse().map((b, i, arr) => (
                <tr key={b.band} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td className="px-4 py-2.5" style={{ color: scoreColor(b.band) }}>
                    {b.band} <span style={{ color: C.dim }}>{RATING_LABEL[String(b.band)]}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.text }}>{b.apps}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: b.hired ? C.green : C.dim }}>{b.hired}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.muted }}>{b.archived}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.muted }}>{b.active}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: b.hireRate == null ? C.dim : b.hireRate >= 20 ? C.green : b.hireRate > 0 ? C.amber : C.dim }}>
                    {b.hireRate == null ? '—' : `${b.hireRate.toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
          Hire rate is of decided candidates only (hired or rejected) — people still in process can&rsquo;t
          count against a band yet.
        </p>
      </div>

      {/* Hires, opened up */}
      {!!(data?.hires ?? []).length && (
        <div>
          <div className="flex items-end justify-between gap-3 flex-wrap mb-1">
            <span className={`${UPLABEL} block`} style={{ color: C.muted }}>Hires — full scorecard breakdown</span>
            <button
              onClick={() => setExpanded(allOpen ? new Set() : new Set((data?.hires ?? []).map((h) => h.applicationId)))}
              className="font-mono text-[11px] px-2 py-1 rounded-md"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer' }}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>
          <span className="font-mono text-[11px] block mb-3" style={{ color: C.dim }}>
            Click a name for every scorecard they collected · &ldquo;Range&rdquo; flags where the panel disagreed
          </span>
          <div className="rounded-lg overflow-hidden" style={CARD}>
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Candidate</th>
                  <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Role</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Avg</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Scorecards</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Range</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hired</th>
                </tr>
              </thead>
              <tbody>
                {(data?.hires ?? []).map((h, i, arr) => (
                  <HireRow
                    key={h.applicationId}
                    h={h}
                    open={expanded.has(h.applicationId)}
                    last={i === arr.length - 1}
                    onToggle={() => setExpanded((prev) => {
                      const next = new Set(prev)
                      if (next.has(h.applicationId)) next.delete(h.applicationId)
                      else next.add(h.applicationId)
                      return next
                    })}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
            Hire date is approximated by the application&rsquo;s last transition — Ashby doesn&rsquo;t expose a
            dedicated hire-date field.
          </p>
        </div>
      )}

      {/* Stage baselines */}
      <div>
        <span className={`${UPLABEL} block mb-1`} style={{ color: C.muted }}>Scores by stage</span>
        <span className="font-mono text-[11px] block mb-3" style={{ color: C.dim }}>
          Later stages see an already-filtered population, so averages rise as the funnel narrows
        </span>
        <div className="rounded-lg overflow-hidden" style={CARD}>
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Stage</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Scorecards</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Avg</th>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Mix</th>
              </tr>
            </thead>
            <tbody>
              {(data?.stages ?? []).map((s, i, arr) => (
                <tr key={s.stage} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td className="px-4 py-2.5" style={{ color: C.text }}>
                    {s.stage}
                    <span className="block mt-1 rounded-sm" style={{ height: 2, width: `${(s.n / maxStageN) * 100}%`, maxWidth: 180, background: C.blue + '55' }} />
                  </td>
                  <td className="px-4 py-2.5 text-right align-top" style={{ color: C.muted }}>{s.n}</td>
                  <td className="px-4 py-2.5 text-right align-top" style={{ color: scoreColor(Math.round(s.avg)) }}>{f2(s.avg)}</td>
                  <td className="px-4 py-2.5 align-top"><DistBar dist={s.dist} total={s.n} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interviewer calibration */}
      <div>
        <span className={`${UPLABEL} block mb-1`} style={{ color: C.muted }}>By interviewer</span>
        <span className="font-mono text-[11px] block mb-3" style={{ color: C.dim }}>
          &ldquo;vs stage&rdquo; is the comparable number — how far above or below the average for the same stages they ran
        </span>
        <div className="rounded-lg overflow-hidden" style={CARD}>
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Interviewer</th>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Mostly</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Scorecards</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Avg</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>vs stage</th>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Mix</th>
              </tr>
            </thead>
            <tbody>
              {(data?.interviewers ?? []).map((p, i, arr) => (
                <tr key={p.name} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td className="px-4 py-2.5" style={{ color: C.text }}>{p.name}</td>
                  <td className="px-4 py-2.5" style={{ color: C.dim }}>{p.topStage ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: C.muted }}>{p.n}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: scoreColor(Math.round(p.avg)) }}>{f2(p.avg)}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: p.vsStage == null ? C.dim : Math.abs(p.vsStage) < 0.25 ? C.dim : p.vsStage > 0 ? C.green : C.amber }}>
                    {p.vsStage == null ? '—' : `${p.vsStage >= 0 ? '+' : ''}${p.vsStage.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-2.5"><DistBar dist={p.dist} total={p.n} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
          Read &ldquo;vs stage&rdquo; with the scorecard count next to it — a few points either way means little
          across a handful of interviews.
          {!!t?.unresolvedStage && ` ${t.unresolvedStage} scorecard${t.unresolvedStage === 1 ? '' : 's'} couldn't be matched to a stage and sit out the stage and vs-stage figures.`}
        </p>
      </div>
    </div>
  )
}
