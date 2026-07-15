'use client'

import { WeekData, acceptRate, replyRate, fmt1 } from '@/lib/types'
import { BarChart, Bar, ResponsiveContainer, Tooltip } from 'recharts'

interface RecruiterCardsProps {
  weeks: WeekData[]
}

function MiniBar({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v) => ({ v }))
  return (
    <ResponsiveContainer width="100%" height={40}>
      <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <Tooltip
          contentStyle={{ backgroundColor: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', fontSize: 11 }}
          formatter={(v: number) => [`${fmt1(v)}%`]}
          labelFormatter={() => ''}
        />
        <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RecruiterCards({ weeks }: RecruiterCardsProps) {
  const names = Array.from(new Set(weeks.flatMap((w) => w.rows.map((r) => r.name))))

  return (
    <div>
      <h2 className="font-mono text-xs uppercase tracking-wide mb-3" style={{ color: 'var(--ds-muted)' }}>
        Per-Recruiter Trends
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {names.map((name) => {
          const perWeek = weeks.map((w) => {
            const row = w.rows.find((r) => r.name === name)
            return row ?? null
          })

          const replyRates = perWeek.map((r) => (r ? replyRate(r.replies, r.invites) : 0))
          const acceptRates = perWeek.map((r) => (r ? acceptRate(r.accepted, r.invites) : 0))
          const totalInvites = perWeek.reduce((s, r) => s + (r?.invites ?? 0), 0)
          const totalReplies = perWeek.reduce((s, r) => s + (r?.replies ?? 0), 0)
          const latestRow = perWeek[perWeek.length - 1]

          return (
            <div
              key={name}
              className="rounded-lg p-4"
              style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>{name}</span>
                {latestRow && (
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'rgba(55,138,221,0.15)', color: '#378add' }}>
                    {latestRow.campaigns} campaign{latestRow.campaigns !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <span className="font-mono text-xs block mb-1" style={{ color: 'var(--ds-dim)' }}>Total Invites</span>
                  <span className="font-mono text-lg font-medium" style={{ color: 'var(--ds-text)' }}>{totalInvites.toLocaleString()}</span>
                </div>
                <div>
                  <span className="font-mono text-xs block mb-1" style={{ color: 'var(--ds-dim)' }}>Total Replies</span>
                  <span className="font-mono text-lg font-medium" style={{ color: 'var(--ds-text)' }}>{totalReplies.toLocaleString()}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="font-mono text-xs block mb-1" style={{ color: 'var(--ds-dim)' }}>Reply Rate</span>
                  <MiniBar data={replyRates} color="#c98a1a" />
                </div>
                <div>
                  <span className="font-mono text-xs block mb-1" style={{ color: 'var(--ds-dim)' }}>Accept Rate</span>
                  <MiniBar data={acceptRates} color="#378add" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
