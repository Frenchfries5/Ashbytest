'use client'

import { WeekData, aggregateWeek, acceptRate, replyRate, fmt1 } from '@/lib/types'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'

interface RateChartsProps {
  weeks: WeekData[]
}

function RateChart({
  title,
  data,
  color,
  avg,
}: {
  title: string
  data: { label: string; value: number }[]
  color: string
  avg: number
}) {
  return (
    <div
      className="rounded-lg p-5 flex-1"
      style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-xs uppercase tracking-wide" style={{ color: 'var(--ds-muted)' }}>
          {title}
        </span>
        <span
          className="font-mono text-xs px-2 py-0.5 rounded"
          style={{ backgroundColor: color + '22', color }}
        >
          avg {fmt1(avg)}%
        </span>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fill: '#484f58', fontSize: 10, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#484f58', fontSize: 10, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${fmt1(v)}%`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
            labelStyle={{ color: '#e6edf3' }}
            formatter={(v: number) => [`${fmt1(v)}%`, title]}
          />
          <ReferenceLine y={avg} stroke={color} strokeDasharray="4 4" strokeOpacity={0.5} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ fill: color, r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function RateCharts({ weeks }: RateChartsProps) {
  const replyData = weeks.map((w) => {
    const agg = aggregateWeek(w)
    return { label: w.label, value: replyRate(agg.replies, agg.messages) }
  })
  const acceptData = weeks.map((w) => {
    const agg = aggregateWeek(w)
    return { label: w.label, value: acceptRate(agg.accepted, agg.invites) }
  })

  const avgReply = replyData.reduce((s, d) => s + d.value, 0) / (replyData.length || 1)
  const avgAccept = acceptData.reduce((s, d) => s + d.value, 0) / (acceptData.length || 1)

  return (
    <div className="flex flex-col gap-3 md:flex-row">
      <RateChart title="Reply Rate %" data={replyData} color="#c98a1a" avg={avgReply} />
      <RateChart title="Accept Rate %" data={acceptData} color="#378add" avg={avgAccept} />
    </div>
  )
}
