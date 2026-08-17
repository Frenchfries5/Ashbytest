'use client'

import { useState } from 'react'
import useSWR from 'swr'

// The same named weekly activity the Friday email leads with — who moved, to what stage, when, and
// how they scored — plus a picker for walking back through previous weeks.
//
// "Moved forward" is derived from completed interview events rather than current stage: an
// application's stage decays to "Archived" once someone is rejected, so a stage-based read would
// quietly lose people who did progress.

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Rating { latest: number | null; count: number }
interface Digest {
  configured: boolean
  reqs: string[]
  weekStart: string
  weekEnd: string
  newApplications: number
  screened: { name: string; at: string; rating: Rating }[]
  movements: { name: string; stage: string; at: string; rating: Rating }[]
  ratings: { average: number | null; count: number; distribution: Record<string, number> }
}

const C = {
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green-light)', blue: 'var(--ds-blue)', amber: 'var(--ds-amber)',
  border: 'var(--ds-border)', surface: 'var(--ds-surface)', bg: 'var(--ds-bg)',
}
const CARD = { backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 } as const
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider block'
const RATING_LABEL: Record<string, string> = { '4': 'Strong yes', '3': 'Yes', '2': 'No', '1': 'Strong no' }
// 4/3 are advance signals, 2/1 are not — colour them so a low-scoring advance stands out.
const ratingColor = (n: number) => (n >= 4 ? C.green : n === 3 ? C.blue : n === 2 ? C.amber : '#f87171')

function RatingCell({ rating }: { rating: { latest: number | null; count: number } }) {
  if (rating?.latest == null) return <span style={{ color: C.dim }}>—</span>
  return (
    <span style={{ color: ratingColor(rating.latest) }}>
      {rating.latest} <span style={{ color: C.dim }}>{RATING_LABEL[String(rating.latest)]}</span>
      {rating.count > 1 && <span style={{ color: C.dim }}> ·{rating.count}</span>}
    </span>
  )
}

const DAY = 86_400_000
function mondayUTC(ms: number): number {
  const d = new Date(ms)
  const dow = (d.getUTCDay() + 6) % 7
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)
}
const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts })

// Label a week as "Aug 10–16", collapsing the month when both ends share one.
function weekLabel(startMs: number): string {
  const endMs = startMs + 6 * DAY
  const a = fmt(startMs, { month: 'short', day: 'numeric' })
  const b = fmt(endMs, new Date(startMs).getUTCMonth() === new Date(endMs).getUTCMonth()
    ? { day: 'numeric' } : { month: 'short', day: 'numeric' })
  return `${a}–${b}`
}

const WEEKS_BACK = 12

export function PipelineMovement({ role = 'growth' }: { role?: string }) {
  const [weeksAgo, setWeeksAgo] = useState(0)
  const { data, isLoading } = useSWR<Digest>(
    `/api/ashby/weekly-digest?role=${encodeURIComponent(role)}&weeksAgo=${weeksAgo}`,
    fetcher, { refreshInterval: 300_000, keepPreviousData: true }
  )

  const thisMonday = mondayUTC(Date.now())
  const options = Array.from({ length: WEEKS_BACK }, (_, i) => ({
    value: i,
    label: i === 0 ? `This week (${weekLabel(thisMonday)})` : weekLabel(thisMonday - i * DAY * 7),
  }))

  if (data && !data.configured && !isLoading) return null

  const stats = [
    { label: 'New applications', value: data?.newApplications ?? 0, color: C.blue },
    { label: 'Screened', value: data?.screened.length ?? 0, color: C.text },
    { label: 'Moved forward', value: data?.movements.length ?? 0, color: C.green },
  ]
  const avg = data?.ratings.average
  const day = (isoStr: string) => fmt(Date.parse(isoStr), { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div>
          <span className={UPLABEL} style={{ color: C.muted }}>Pipeline movement</span>
          <span className="font-mono text-[11px] mt-1 block" style={{ color: C.dim }}>
            {data?.reqs?.[0] ?? 'Growth req'} · who advanced, and when
          </span>
        </div>
        <select
          value={weeksAgo}
          onChange={(e) => setWeeksAgo(Number(e.target.value))}
          className="font-mono text-xs px-2.5 py-1.5 rounded-md outline-none"
          style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer' }}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="p-4 rounded-lg" style={CARD}>
            <span className={UPLABEL} style={{ color: C.muted }}>{s.label}</span>
            <div className="font-mono text-[26px] leading-none font-medium mt-1.5" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
        <div className="p-4 rounded-lg" style={CARD}>
          <span className={UPLABEL} style={{ color: C.muted }}>Avg rating</span>
          <div className="font-mono text-[26px] leading-none font-medium mt-1.5" style={{ color: avg != null ? C.amber : C.dim }}>
            {avg != null ? avg.toFixed(1) : '—'}
          </div>
          <span className="font-mono text-[10.5px] mt-1.5 block" style={{ color: C.dim }}>
            {data?.ratings.count
              ? `${data.ratings.count} scorecard${data.ratings.count === 1 ? '' : 's'} · 4 = strong yes`
              : 'no scorecards'}
          </span>
        </div>
      </div>

      {/* Who advanced */}
      <div className="rounded-lg overflow-hidden mt-3" style={CARD}>
        {data?.movements.length ? (
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Candidate</th>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Advanced to</th>
                <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Rating</th>
                <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>When</th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m, i) => (
                <tr key={`${m.name}-${m.stage}-${m.at}`} style={{ borderBottom: i < data.movements.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td className="px-4 py-2.5" style={{ color: C.text }}>{m.name}</td>
                  <td className="px-4 py-2.5" style={{ color: C.text }}>{m.stage}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><RatingCell rating={m.rating} /></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap" style={{ color: C.muted }}>{day(m.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-3 font-mono text-xs" style={{ color: C.muted }}>
            {isLoading ? 'Loading…' : 'No one advanced to a later round this week.'}
          </p>
        )}
      </div>

      {/* Who was screened */}
      {!!data?.screened.length && (
        <div className="rounded-lg mt-3 px-4 py-3" style={CARD}>
          <span className={UPLABEL} style={{ color: C.dim }}>Screened</span>
          <p className="font-mono text-xs mt-1.5 leading-relaxed" style={{ color: C.text }}>
            {data.screened.map((s, i) => (
              <span key={`${s.name}-${s.at}`}>
                {i > 0 && <span style={{ color: C.dim }}> · </span>}
                {s.name}{' '}
                {s.rating?.latest != null && (
                  <span style={{ color: ratingColor(s.rating.latest) }}>{s.rating.latest} </span>
                )}
                <span style={{ color: C.dim }}>{day(s.at)}</span>
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Rating mix — only meaningful when scorecards exist */}
      {!!data?.ratings.count && (
        <div className="rounded-lg mt-3 px-4 py-3" style={CARD}>
          <span className={UPLABEL} style={{ color: C.dim }}>Scorecards</span>
          <p className="font-mono text-xs mt-1.5" style={{ color: C.text }}>
            {['4', '3', '2', '1']
              .filter((k) => (data.ratings.distribution[k] ?? 0) > 0)
              .map((k) => `${RATING_LABEL[k]}: ${data.ratings.distribution[k]}`)
              .join('  ·  ')}
          </p>
        </div>
      )}

      <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
        Same view the Friday email sends. &ldquo;Moved forward&rdquo; counts completed interviews at a stage past
        the screen, so it reflects rounds that actually happened; the current week fills in as the week goes on.
      </p>
    </div>
  )
}
