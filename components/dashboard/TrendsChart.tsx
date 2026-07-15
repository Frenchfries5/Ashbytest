'use client'

import { WeekData, aggregateWeek } from '@/lib/types'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface TrendsChartProps {
  weeks: WeekData[]
}

export function TrendsChart({ weeks }: TrendsChartProps) {
  const data = weeks.map((w) => {
    const agg = aggregateWeek(w)
    return { label: w.label, invites: agg.invites, messages: agg.messages, replies: agg.replies }
  })

  return (
    <div
      className="rounded-lg p-5"
      style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
    >
      <div className="mb-4 flex items-center gap-4 flex-wrap">
        <span className="font-mono text-xs uppercase tracking-wide" style={{ color: 'var(--ds-muted)' }}>
          Activity Over Time
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis dataKey="label" tick={{ fill: '#484f58', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#484f58', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            contentStyle={{ backgroundColor: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
            labelStyle={{ color: '#e6edf3' }}
            itemStyle={{ color: '#8b949e' }}
          />
          <Legend wrapperStyle={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: '#8b949e', paddingTop: 8 }} />
          <Line type="monotone" dataKey="invites" stroke="#1a9e6e" strokeWidth={2} dot={false} name="Invites" />
          <Line type="monotone" dataKey="messages" stroke="#378add" strokeWidth={2} dot={false} name="Messages" />
          <Line type="monotone" dataKey="replies" stroke="#3adea0" strokeWidth={2} dot={false} name="Replies" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
