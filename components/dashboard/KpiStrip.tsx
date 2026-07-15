'use client'

import { WeekData, aggregateWeek, acceptRate, replyRate, fmt1 } from '@/lib/types'
import { BarChart, Bar, ResponsiveContainer } from 'recharts'

interface KpiStripProps {
  weeks: WeekData[]
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v) => ({ v }))
  return (
    <ResponsiveContainer width="100%" height={32}>
      <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <Bar dataKey="v" fill={color} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  const positive = delta >= 0
  return (
    <span
      className="font-mono text-xs"
      style={{ color: positive ? 'var(--ds-green-light)' : '#f87171' }}
    >
      {positive ? '▲' : '▼'} {Math.abs(delta).toFixed(positive ? 0 : 1)}
      {delta % 1 !== 0 ? '%' : ''}
    </span>
  )
}

export function KpiStrip({ weeks }: KpiStripProps) {
  if (!weeks.length) return null

  const aggregated = weeks.map(aggregateWeek)
  const latest = aggregated[aggregated.length - 1]
  const prior = aggregated.length > 1 ? aggregated[aggregated.length - 2] : null

  const latestAccept = acceptRate(latest.accepted, latest.invites)
  const latestReply = replyRate(latest.replies, latest.invites)
  const priorAccept = prior ? acceptRate(prior.accepted, prior.invites) : null
  const priorReply = prior ? replyRate(prior.replies, prior.invites) : null

  const kpis = [
    {
      label: 'Total Invites',
      value: latest.invites.toLocaleString(),
      delta: prior ? latest.invites - prior.invites : null,
      spark: aggregated.map((a) => a.invites),
      color: '#1a9e6e',
    },
    {
      label: 'Accept Rate',
      value: `${fmt1(latestAccept)}%`,
      delta: priorAccept !== null ? latestAccept - priorAccept : null,
      spark: aggregated.map((a) => acceptRate(a.accepted, a.invites)),
      color: '#378add',
    },
    {
      label: 'Reply Rate',
      value: `${fmt1(latestReply)}%`,
      delta: priorReply !== null ? latestReply - priorReply : null,
      spark: aggregated.map((a) => replyRate(a.replies, a.invites)),
      color: '#c98a1a',
    },
    {
      label: 'Total Replies',
      value: latest.replies.toLocaleString(),
      delta: prior ? latest.replies - prior.replies : null,
      spark: aggregated.map((a) => a.replies),
      color: '#3adea0',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className="rounded-lg p-4 flex flex-col gap-2"
          style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
        >
          <span className="font-mono text-xs uppercase tracking-wide" style={{ color: 'var(--ds-muted)' }}>
            {kpi.label}
          </span>
          <div className="flex items-end justify-between gap-2">
            <span className="font-mono text-2xl font-medium" style={{ color: 'var(--ds-text)' }}>
              {kpi.value}
            </span>
            {kpi.delta !== null && <DeltaBadge delta={kpi.delta} />}
          </div>
          <Sparkline data={kpi.spark} color={kpi.color} />
        </div>
      ))}
    </div>
  )
}
