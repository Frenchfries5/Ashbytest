'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { acceptRate, replyRate, fmt1 } from '@/lib/types'

// Standalone TEST page (not wired into the main tab bar) for eyeballing MeetAlfred weekly
// outbound data against the manual spreadsheet. Visit /meetalfred-test.

type Metric = 'invites' | 'accepted' | 'messages' | 'replies'
const METRICS: Metric[] = ['invites', 'accepted', 'messages', 'replies']

interface MemberWeek { name: string; memberId: number; invites: number; accepted: number; messages: number; replies: number }
interface WeekRow { weekStart: string; label: string; rows: MemberWeek[]; totals: Omit<MemberWeek, 'name' | 'memberId'> }
interface MemberMeta { name: string; memberId: number }
interface WeeklyResp {
  configured: boolean
  windowWeeks?: number
  lastSyncedAt?: string | null
  members?: MemberMeta[]
  weeks?: WeekRow[]
  error?: string
  hint?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const C = {
  surface: 'var(--ds-surface)', border: 'var(--ds-border)', text: 'var(--ds-text)',
  muted: 'var(--ds-muted)', dim: 'var(--ds-dim)', green: 'var(--ds-green-light)',
  blue: 'var(--ds-blue)', amber: 'var(--ds-amber)',
}
const CARD = { background: C.surface, border: `1px solid ${C.border}` }
const UP = 'font-mono text-[11px] uppercase tracking-wider'

export default function MeetAlfredTestPage() {
  const [weeks, setWeeks] = useState(12)
  const [metric, setMetric] = useState<Metric>('invites')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const { data, isLoading, error, mutate, isValidating } = useSWR<WeeklyResp>(
    `/api/meetalfred/weekly?weeks=${weeks}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/meetalfred/sync?mode=incremental', { method: 'POST' })
      const j = await res.json()
      if (j.ok) {
        setSyncMsg(`Synced ${j.upserted} events in ${(j.elapsedMs / 1000).toFixed(0)}s.`)
        await mutate()
      } else {
        setSyncMsg(`Sync failed: ${j.error ?? 'unknown error'}`)
      }
    } catch {
      setSyncMsg('Sync failed (network).')
    } finally {
      setSyncing(false)
    }
  }

  const lastSynced = data?.lastSyncedAt ? new Date(data.lastSyncedAt) : null

  const members = data?.members ?? []
  const weekRows = data?.weeks ?? []
  const rev = [...weekRows].reverse() // newest first for display

  // Window totals
  const tot = weekRows.reduce(
    (a, w) => ({
      invites: a.invites + w.totals.invites,
      accepted: a.accepted + w.totals.accepted,
      messages: a.messages + w.totals.messages,
      replies: a.replies + w.totals.replies,
    }),
    { invites: 0, accepted: 0, messages: 0, replies: 0 }
  )

  return (
    <div style={{ backgroundColor: 'var(--ds-bg)', minHeight: '100vh' }}>
      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col gap-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-medium" style={{ color: C.text }}>MeetAlfred — Weekly Outbound <span style={{ color: C.dim }}>(test)</span></h1>
            <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
              Per-user, per-week invites · accepted · messages · replies — served from the synced database
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-0 p-1 rounded-lg" style={CARD}>
              {[8, 12, 16, 26].map((w) => (
                <button key={w} onClick={() => setWeeks(w)}
                  className="font-mono text-xs px-3 py-1.5 rounded-md transition-all"
                  style={{ background: weeks === w ? C.blue + '22' : 'none', color: weeks === w ? C.blue : C.muted, border: weeks === w ? `1px solid ${C.blue}44` : '1px solid transparent' }}>
                  {w}w
                </button>
              ))}
            </div>
            <button onClick={() => mutate()} disabled={isValidating}
              className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ ...CARD, color: isValidating ? C.dim : C.muted, cursor: isValidating ? 'wait' : 'pointer' }}>
              {isValidating ? 'Reloading…' : 'Reload'}
            </button>
            <button onClick={handleSync} disabled={syncing}
              className="font-mono text-xs px-3 py-1.5 rounded-lg transition-all"
              style={{ background: C.green + '22', color: syncing ? C.dim : C.green, border: `1px solid ${C.green}44`, cursor: syncing ? 'wait' : 'pointer' }}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </div>

        {/* Sync status / last-synced line */}
        <div className="flex items-center gap-3 font-mono text-xs -mt-4" style={{ color: C.dim }}>
          <span>{lastSynced ? `Last synced ${lastSynced.toLocaleString()}` : 'Never synced — run the one-time backfill.'}</span>
          {syncMsg && <span style={{ color: C.muted }}>· {syncMsg}</span>}
        </div>

        {/* States */}
        {isLoading && <div className="font-mono text-sm py-16 text-center" style={{ color: C.muted }}>Loading from database…</div>}
        {error && <div className="font-mono text-sm py-8 text-center" style={{ color: '#f87171' }}>Request failed.</div>}
        {data && !data.configured && <div className="font-mono text-sm py-8 text-center" style={{ color: C.amber }}>{data.hint || 'MeetAlfred not configured.'}</div>}
        {data?.error && <div className="font-mono text-sm py-8 text-center" style={{ color: '#f87171' }}>API error: {data.error}</div>}

        {data?.configured && weekRows.length > 0 && (
          <>
            {/* Window KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Invites', value: tot.invites, color: C.blue },
                { label: 'Accepted', value: tot.accepted, sub: `${fmt1(acceptRate(tot.accepted, tot.invites))}% accept`, color: C.green },
                { label: 'Messages', value: tot.messages, color: C.text },
                { label: 'Replies', value: tot.replies, sub: `${fmt1(replyRate(tot.replies, tot.invites))}% of invites`, color: C.amber },
              ].map((k) => (
                <div key={k.label} className="rounded-lg p-5 flex flex-col gap-2" style={CARD}>
                  <span className={UP} style={{ color: C.muted }}>{k.label} · {weeks}w</span>
                  <span className="text-3xl font-medium leading-none" style={{ color: k.color }}>{k.value.toLocaleString()}</span>
                  <span className="font-mono text-xs" style={{ color: C.dim }}>{k.sub ?? ' '}</span>
                </div>
              ))}
            </div>

            {/* Members */}
            <div className="flex flex-wrap gap-3">
              {members.map((m) => (
                <div key={m.memberId} className="rounded-lg px-4 py-2 font-mono text-xs flex items-center gap-3" style={CARD}>
                  <span style={{ color: C.text }}>{m.name}</span>
                </div>
              ))}
            </div>

            {/* Metric matrix: weeks × members + team total, for one metric */}
            <div className="rounded-lg overflow-hidden" style={CARD}>
              <div className="px-5 py-4 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
                <span className={UP} style={{ color: C.muted }}>Week × User — single metric</span>
                <div className="flex gap-0 p-1 rounded-lg" style={{ background: 'var(--ds-bg)', border: `1px solid ${C.border}` }}>
                  {METRICS.map((mt) => (
                    <button key={mt} onClick={() => setMetric(mt)}
                      className="font-mono text-xs px-3 py-1 rounded-md capitalize transition-all"
                      style={{ background: metric === mt ? C.green + '22' : 'none', color: metric === mt ? C.green : C.muted }}>
                      {mt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      <th className="px-5 py-3 text-left font-normal" style={{ color: C.muted }}>Week</th>
                      {members.map((m) => <th key={m.memberId} className="px-5 py-3 text-right font-normal" style={{ color: C.muted }}>{m.name}</th>)}
                      <th className="px-5 py-3 text-right font-normal" style={{ color: C.text }}>Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rev.map((w, i) => (
                      <tr key={w.weekStart} style={{ borderBottom: i < rev.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <td className="px-5 py-2.5" style={{ color: C.text }}>{w.label}</td>
                        {w.rows.map((r) => <td key={r.memberId} className="px-5 py-2.5 text-right" style={{ color: C.dim }}>{r[metric]}</td>)}
                        <td className="px-5 py-2.5 text-right" style={{ color: C.green }}>{w.totals[metric]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Full spreadsheet-style breakdown: every metric, per user, per week + team total */}
            <div className="rounded-lg overflow-hidden" style={CARD}>
              <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
                <span className={UP} style={{ color: C.muted }}>Full breakdown (mirrors the manual sheet)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {['Week', 'User', 'Invites', 'Accepted', 'Messages', 'Replies', 'Accept %', 'Reply %'].map((h) => (
                        <th key={h} className={`px-4 py-3 font-normal ${h === 'Week' || h === 'User' ? 'text-left' : 'text-right'}`} style={{ color: C.muted }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rev.map((w) => (
                      <WeekBlock key={w.weekStart} week={w} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function WeekBlock({ week }: { week: WeekRow }) {
  const cells = (r: { invites: number; accepted: number; messages: number; replies: number }) => (
    <>
      <td className="px-4 py-2 text-right" style={{ color: C.blue }}>{r.invites}</td>
      <td className="px-4 py-2 text-right" style={{ color: C.green }}>{r.accepted}</td>
      <td className="px-4 py-2 text-right" style={{ color: C.text }}>{r.messages}</td>
      <td className="px-4 py-2 text-right" style={{ color: C.amber }}>{r.replies}</td>
      <td className="px-4 py-2 text-right" style={{ color: C.dim }}>{fmt1(acceptRate(r.accepted, r.invites))}%</td>
      <td className="px-4 py-2 text-right" style={{ color: C.dim }}>{fmt1(replyRate(r.replies, r.invites))}%</td>
    </>
  )
  return (
    <>
      {week.rows.map((r, i) => (
        <tr key={r.memberId} style={{ borderTop: i === 0 ? `2px solid ${C.border}` : `1px solid ${C.border}22` }}>
          {i === 0 ? <td className="px-4 py-2 align-top font-medium" style={{ color: C.text }} rowSpan={week.rows.length + 1}>{week.label}</td> : null}
          <td className="px-4 py-2" style={{ color: C.muted }}>{r.name}</td>
          {cells(r)}
        </tr>
      ))}
      <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
        <td className="px-4 py-2 font-medium" style={{ color: C.text }}>Team total</td>
        {cells(week.totals)}
      </tr>
    </>
  )
}
