'use client'

import { WeekData } from '@/lib/types'

interface TopbarProps {
  weeks: WeekData[]
}

export function Topbar({ weeks }: TopbarProps) {
  const latest = weeks[weeks.length - 1]

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--ds-border)', backgroundColor: 'var(--ds-surface)' }}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>Coverdash</span>
        <span style={{ color: 'var(--ds-dim)' }}>/</span>
        <span className="text-sm" style={{ color: 'var(--ds-muted)' }}>recruiting ops</span>
      </div>
      {latest && (
        <span className="font-mono text-xs" style={{ color: 'var(--ds-muted)' }}>
          {weeks.length} week{weeks.length !== 1 ? 's' : ''} · latest: {latest.label}
        </span>
      )}
    </header>
  )
}
