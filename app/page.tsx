'use client'

import { useState, useEffect, useMemo } from 'react'
import useSWR, { preload } from 'swr'
import { WeekData } from '@/lib/types'
import { isCurrentWeekStart } from '@/lib/week'
import { Topbar } from '@/components/dashboard/Topbar'
import { KpiStrip } from '@/components/dashboard/KpiStrip'
import { TrendsChart } from '@/components/dashboard/TrendsChart'
import { RateCharts } from '@/components/dashboard/RateCharts'
import { RecruiterCards } from '@/components/dashboard/RecruiterCards'
import { WeeklyDetail } from '@/components/dashboard/WeeklyDetail'
import { InboundDashboard } from '@/components/dashboard/InboundDashboard'
import { AshbyDashboard, fetchAshbyWeekly } from '@/components/dashboard/AshbyDashboard'
import { PipelineDashboard } from '@/components/dashboard/PipelineDashboard'
import { InterviewsDashboard } from '@/components/dashboard/InterviewsDashboard'
import { ExecutiveSummary, fetchAshbyWeeks, fetchWeeklyHires, fetchPipelineOutcomes, fetchRecruiterScreens } from '@/components/dashboard/ExecutiveSummary'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type TopTab = 'exec' | 'sourcing' | 'inbound' | 'ashby' | 'pipeline' | 'interviews'

export default function DashboardPage() {
  const [tab, setTab] = useState<TopTab>('exec')
  // Outbound Sourcing is sourced from MeetAlfred (synced into Supabase), not the manual
  // spreadsheet. /api/meetalfred/sourcing returns the same WeekData[] shape the components expect.
  const { data, isLoading } = useSWR<{ weeks: WeekData[] }>('/api/meetalfred/sourcing', fetcher)

  // Warm every tab's data on first load (SWR dedupes by key), so switching tabs feels
  // instant instead of kicking off a slow Ashby fetch only once its tab is opened.
  useEffect(() => {
    preload('/api/ashby/pipeline', fetcher)
    preload('ashby-weekly:dashboard', fetchAshbyWeekly)
    preload('ashby-weekly:summary', fetchAshbyWeeks)
    preload('ashby-hires:summary', fetchWeeklyHires)
    preload('ashby-pipeline-outcomes:summary', fetchPipelineOutcomes)
    preload('ashby-recruiter-screens:summary', fetchRecruiterScreens)
    preload('/api/inbound/postings', fetcher)
  }, [])

  const weeks: WeekData[] = data?.weeks ?? []
  // The current week is still in progress — its counts always start at 0 and climb through the
  // week, which reads as a fake dip in trend charts/averages. Charts get the completed weeks
  // only; tables (Weekly Detail) still show the live week, tagged, since the number itself is
  // accurate context, just partial.
  const chartWeeks = useMemo(() => weeks.filter((w) => !isCurrentWeekStart(w.weekStart)), [weeks])

  const firstLabel = weeks[0]?.label ?? ''
  const lastLabel = weeks[weeks.length - 1]?.label ?? ''
  const dateRange = firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`

  return (
    <div style={{ backgroundColor: 'var(--ds-bg)', minHeight: '100vh' }}>
      <Topbar weeks={weeks} />

      {/* Top-level tab bar */}
      <div
        className="sticky top-0 z-10 flex gap-1 px-6 pt-4 pb-0"
        style={{ backgroundColor: 'var(--ds-bg)', borderBottom: '1px solid var(--ds-border)' }}
      >
        {(['exec', 'sourcing', 'inbound', 'ashby', 'pipeline', 'interviews'] as TopTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="font-mono text-sm px-5 py-2.5 capitalize transition-colors"
            style={{
              color: tab === t ? 'var(--ds-text)' : 'var(--ds-muted)',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--ds-green-light)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t === 'exec' ? 'Executive Summary' : t === 'sourcing' ? 'Outbound Sourcing' : t === 'inbound' ? 'Inbound Postings' : t === 'ashby' ? 'Ashby Inbound' : t === 'pipeline' ? 'Pipeline' : 'Interviews'}
          </button>
        ))}
      </div>

      <main className="max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">
        {tab === 'exec' ? (
          <ExecutiveSummary onJump={setTab} />
        ) : tab === 'sourcing' ? (
          <>
            {/* Hero */}
            <div>
              <h1 className="text-3xl font-medium leading-tight text-balance" style={{ color: 'var(--ds-text)' }}>
                Sourcing trends
              </h1>
              <p className="mt-1 font-mono text-sm" style={{ color: 'var(--ds-muted)' }}>
                {isLoading ? 'Loading…' : dateRange}
              </p>
            </div>

            <KpiStrip weeks={chartWeeks} />
            <TrendsChart weeks={chartWeeks} />
            <RateCharts weeks={chartWeeks} />
            <RecruiterCards weeks={chartWeeks} />
            <WeeklyDetail weeks={weeks} />
          </>
        ) : tab === 'inbound' ? (
          <InboundDashboard />
        ) : tab === 'ashby' ? (
          <AshbyDashboard />
        ) : tab === 'pipeline' ? (
          <PipelineDashboard />
        ) : (
          <InterviewsDashboard />
        )}
      </main>
    </div>
  )
}
