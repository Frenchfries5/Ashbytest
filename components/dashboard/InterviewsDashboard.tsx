'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { isCurrentWeekStart } from '@/lib/week'

interface FunnelCell { screens: number; movedForward: number }
interface FunnelWeek {
  weekStart: string
  label: string
  total: FunnelCell
  byInterviewer: Record<string, FunnelCell>
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const C = {
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green-light)', border: 'var(--ds-border)', surface: 'var(--ds-surface)', blue: 'var(--ds-blue)',
}
const CARD = { backgroundColor: C.surface, border: `1px solid ${C.border}` } as const

function rate(mf: number, s: number): number | null {
  return s > 0 ? (mf / s) * 100 : null
}
function rateColor(pct: number | null): string {
  if (pct === null) return C.dim
  if (pct >= 40) return C.green   // ≥40% green
  if (pct >= 20) return 'var(--ds-amber)' // 20–39% amber
  return '#f87171'                // <20% red
}

export function InterviewsDashboard() {
  const { data, isLoading } = useSWR<{ configured: boolean; weeks: FunnelWeek[]; interviewers: string[] }>(
    '/api/ashby/interviews/funnel', fetcher, { refreshInterval: 300_000 }
  )
  const [who, setWho] = useState<string>('all') // 'all' | interviewer name

  const weeks = data?.weeks ?? []
  const interviewers = data?.interviewers ?? []
  const pick = (w: FunnelWeek): FunnelCell =>
    (who === 'all' ? w.total : w.byInterviewer?.[who]) ?? { screens: 0, movedForward: 0 }

  const rows = [...weeks].reverse()
  const completed = weeks.filter((w) => !isCurrentWeekStart(w.weekStart))
  const totScreens = completed.reduce((s, w) => s + pick(w).screens, 0)
  const totMoved = completed.reduce((s, w) => s + pick(w).movedForward, 0)

  const pill = (active: boolean) => ({
    backgroundColor: active ? C.blue : 'var(--ds-surface)',
    color: active ? '#fff' : C.muted,
    border: `1px solid ${active ? C.blue : C.border}`,
  })

  return (
    <div className="flex flex-col gap-7">
      <div>
        <h1 className="text-3xl font-medium leading-tight" style={{ color: C.text }}>Interviews</h1>
        <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
          Recruiter screens by week · &ldquo;moved forward&rdquo; = advanced to a later round
        </p>
      </div>

      {!isLoading && !data?.configured && (
        <div className="rounded-lg p-5 font-mono text-sm" style={{ ...CARD, color: C.muted }}>
          No interview data yet — run the Ashby interviews sync to populate it.
        </div>
      )}

      {data?.configured && (
        <>
          {interviewers.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[11px] uppercase tracking-wider mr-1" style={{ color: C.dim }}>Recruiter</span>
              {['all', ...interviewers].map((name) => (
                <button key={name} onClick={() => setWho(name)}
                  className="font-mono text-xs px-3 py-1 rounded transition-colors"
                  style={pill(who === name)}>
                  {name === 'all' ? 'All' : name}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-lg overflow-hidden" style={CARD}>
            <table className="w-full text-left font-mono text-sm">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                  <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Week</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Recruiter screens</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Moved forward</th>
                  <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w, i) => {
                  const c = pick(w)
                  const r = rate(c.movedForward, c.screens)
                  const live = isCurrentWeekStart(w.weekStart)
                  return (
                    <tr key={w.weekStart} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: C.text }}>
                        {w.label}
                        {live && (
                          <span className="ml-1.5 font-mono text-[9px] px-1 py-0.5 rounded uppercase tracking-wide align-middle"
                            style={{ background: 'rgba(58,222,160,0.15)', color: C.green }}>live</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right" style={{ color: C.text }}>{c.screens}</td>
                      <td className="px-4 py-2.5 text-right" style={{ color: C.text }}>{c.movedForward}</td>
                      <td className="px-4 py-2.5 text-right font-medium" style={{ color: rateColor(r) }}>
                        {r === null ? '—' : `${r.toFixed(0)}%`}
                      </td>
                    </tr>
                  )
                })}
                {rows.length > 0 && (
                  <tr style={{ borderTop: `2px solid ${C.border}`, background: 'rgba(255,255,255,0.02)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: C.text }}>Completed weeks</td>
                    <td className="px-4 py-2.5 text-right font-medium" style={{ color: C.text }}>{totScreens}</td>
                    <td className="px-4 py-2.5 text-right font-medium" style={{ color: C.text }}>{totMoved}</td>
                    <td className="px-4 py-2.5 text-right font-medium" style={{ color: rateColor(rate(totMoved, totScreens)) }}>
                      {rate(totMoved, totScreens) === null ? '—' : `${rate(totMoved, totScreens)!.toFixed(0)}%`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="font-mono text-[11px] leading-relaxed" style={{ color: C.dim }}>
        Screens = completed Recruiter Screen and General Interest introduction-call interviews.
        &ldquo;Moved forward&rdquo; counts screened candidates who later reached a real interview round past
        the screen, tracked per candidate across all their applications (so a General Interest candidate
        who moves to a real req still counts). The current week is partial.
      </p>
    </div>
  )
}
