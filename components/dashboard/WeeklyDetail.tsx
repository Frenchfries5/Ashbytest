'use client'

import { useState } from 'react'
import { WeekData, RecruiterRow, aggregateWeek, acceptRate, replyRate, fmt1 } from '@/lib/types'

interface WeeklyDetailProps {
  weeks: WeekData[]
}

function rateColor(pct: number): string {
  if (pct >= 25) return 'var(--ds-green-light)'
  if (pct >= 15) return 'var(--ds-amber)'
  return '#f87171'
}

/** Sum each recruiter's stats across all weeks */
function buildCumulativeRows(weeks: WeekData[]): RecruiterRow[] {
  const map = new Map<string, RecruiterRow>()
  for (const week of weeks) {
    for (const row of week.rows) {
      const existing = map.get(row.name)
      if (existing) {
        existing.invites += row.invites
        existing.accepted += row.accepted
        existing.messages += row.messages
        existing.replies += row.replies
        existing.campaigns += row.campaigns
      } else {
        map.set(row.name, { ...row })
      }
    }
  }
  return Array.from(map.values())
}

const COLS = ['Recruiter', 'Invites', 'Accepted', 'Accept %', 'Messages', 'Replies', 'Reply %', 'Campaigns']

type ViewMode = 'week' | 'cumulative'

export function WeeklyDetail({ weeks }: WeeklyDetailProps) {
  const [activeIdx, setActiveIdx] = useState(weeks.length - 1)
  const [viewMode, setViewMode] = useState<ViewMode>('week')

  const week = weeks[activeIdx]
  if (!week) return null

  // Determine which rows + summary to show
  const displayRows = viewMode === 'cumulative' ? buildCumulativeRows(weeks) : week.rows
  const agg = viewMode === 'cumulative'
    ? displayRows.reduce(
        (acc, r) => ({
          invites: acc.invites + r.invites,
          accepted: acc.accepted + r.accepted,
          messages: acc.messages + r.messages,
          replies: acc.replies + r.replies,
        }),
        { invites: 0, accepted: 0, messages: 0, replies: 0 }
      )
    : aggregateWeek(week)
  const teamAccept = acceptRate(agg.accepted, agg.invites)
  const teamReply = replyRate(agg.replies, agg.messages)

  return (
    <div>
      <h2 className="font-mono text-xs uppercase tracking-wide mb-3" style={{ color: 'var(--ds-muted)' }}>
        Weekly Detail
      </h2>

      {/* Tab row */}
      <div className="flex gap-1 flex-wrap mb-4 items-center">
        {/* View mode toggle */}
        <div className="flex gap-1 mr-3">
          {(['week', 'cumulative'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className="font-mono text-xs px-3 py-1.5 rounded transition-colors capitalize"
              style={{
                backgroundColor: viewMode === mode ? 'var(--ds-blue)' : 'var(--ds-surface)',
                color: viewMode === mode ? '#fff' : 'var(--ds-muted)',
                border: `1px solid ${viewMode === mode ? 'var(--ds-blue)' : 'var(--ds-border)'}`,
              }}
            >
              {mode === 'week' ? 'By Week' : 'Cumulative'}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-5 mr-2" style={{ backgroundColor: 'var(--ds-border)' }} />

        {/* Week tabs — only enabled in week mode */}
        {weeks.map((w, i) => (
          <button
            key={w.label}
            onClick={() => { setViewMode('week'); setActiveIdx(i) }}
            className="font-mono text-xs px-3 py-1.5 rounded transition-colors"
            style={{
              backgroundColor: viewMode === 'week' && i === activeIdx ? 'var(--ds-green)' : 'var(--ds-surface)',
              color: viewMode === 'week' && i === activeIdx ? '#fff' : 'var(--ds-muted)',
              border: `1px solid ${viewMode === 'week' && i === activeIdx ? 'var(--ds-green)' : 'var(--ds-border)'}`,
              opacity: viewMode === 'cumulative' ? 0.45 : 1,
            }}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Cumulative badge */}
      {viewMode === 'cumulative' && (
        <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full font-mono text-xs"
          style={{ backgroundColor: 'rgba(55,138,221,0.12)', color: 'var(--ds-blue)', border: '1px solid rgba(55,138,221,0.25)' }}>
          All {weeks.length} weeks &mdash; {weeks[0]?.label} through {weeks[weeks.length - 1]?.label}
        </div>
      )}

      {/* Summary row */}
      <div className="grid grid-cols-2 gap-3 mb-4 md:grid-cols-4">
        {[
          { label: 'Total Invites', value: agg.invites.toLocaleString() },
          { label: 'Accept Rate', value: `${fmt1(teamAccept)}%` },
          { label: 'Reply Rate', value: `${fmt1(teamReply)}%` },
          { label: 'Total Replies', value: agg.replies.toLocaleString() },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg px-4 py-3"
            style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
          >
            <span className="font-mono text-xs block mb-1" style={{ color: 'var(--ds-muted)' }}>
              {item.label}
            </span>
            <span className="font-mono text-xl font-medium" style={{ color: 'var(--ds-text)' }}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Table */}
      <div
        className="rounded-lg overflow-auto"
        style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
      >
        <table className="w-full text-left">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
              {COLS.map((h) => (
                <th
                  key={h}
                  className="font-mono text-xs uppercase px-4 py-3 whitespace-nowrap"
                  style={{ color: 'var(--ds-dim)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              const ar = acceptRate(row.accepted, row.invites)
              const rr = replyRate(row.replies, row.messages)
              return (
                <tr
                  key={row.name}
                  className="transition-colors"
                  style={{ borderBottom: '1px solid var(--ds-border)' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'rgba(255,255,255,0.025)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '' }}
                >
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--ds-text)' }}>{row.name}</td>
                  <td className="font-mono text-xs px-4 py-3" style={{ color: 'var(--ds-text)' }}>{row.invites.toLocaleString()}</td>
                  <td className="font-mono text-xs px-4 py-3" style={{ color: 'var(--ds-text)' }}>{row.accepted.toLocaleString()}</td>
                  <td className="font-mono text-xs px-4 py-3 font-medium" style={{ color: rateColor(ar) }}>{fmt1(ar)}%</td>
                  <td className="font-mono text-xs px-4 py-3" style={{ color: 'var(--ds-text)' }}>{row.messages.toLocaleString()}</td>
                  <td className="font-mono text-xs px-4 py-3" style={{ color: 'var(--ds-text)' }}>{row.replies.toLocaleString()}</td>
                  <td className="font-mono text-xs px-4 py-3 font-medium" style={{ color: rateColor(rr) }}>{fmt1(rr)}%</td>
                  <td className="font-mono text-xs px-4 py-3" style={{ color: 'var(--ds-text)' }}>{row.campaigns.toLocaleString()}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
