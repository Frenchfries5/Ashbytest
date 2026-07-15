'use client'

import { useState, useMemo, type ReactNode } from 'react'
import useSWR from 'swr'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { Mail, ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react'
import {
  WeekData, SEED_WEEKS, aggregateWeek, acceptRate, replyRate, fmt1,
} from '@/lib/types'

// ── fetchers ─────────────────────────────────────────────────────────────────
const jsonFetcher = (url: string) => fetch(url).then((r) => r.json())

// ── design constants (match existing dashboard tokens) ───────────────────────
const C = {
  bg: 'var(--ds-bg)', surface: 'var(--ds-surface)', border: 'var(--ds-border)',
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green)', greenL: 'var(--ds-green-light)', blue: 'var(--ds-blue)',
  amber: 'var(--ds-amber)', red: '#f87171',
}
const CARD = { backgroundColor: C.surface, border: `1px solid ${C.border}` }
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider'
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}

// ── Ashby weekly parse (self-contained) ──────────────────────────────────────
interface AshbyWeek { weekOf: Date; label: string; applicants: number; relevant: number }

function weekFromParts(fullLabel: string, applicants: number, relevant: number): AshbyWeek | null {
  const m = fullLabel.match(/^(\w+)\s+(\d+),?\s+(\d{4})/)
  if (!m) return null
  const [, mon, day, year] = m
  const weekOf = new Date(parseInt(year), MONTHS[mon] ?? 0, parseInt(day))
  return { weekOf, label: `${MON_SHORT[MONTHS[mon] ?? 0]} ${parseInt(day)}`, applicants, relevant }
}

function parseAshby(raw: string): AshbyWeek[] {
  const lines = raw.replace(/\r/g, '').trim().split('\n').slice(1)
  const rows: AshbyWeek[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const cols: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue }
      if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    cols.push(cur.trim())
    const row = weekFromParts(cols[0] ?? '', parseInt(cols[1]) || 0, parseInt(cols[2]) || 0)
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => a.weekOf.getTime() - b.weekOf.getTime())
}

interface WeeklyRow { fullLabel: string; applicants: number; relevant: number }

// Prefer the live Ashby API; fall back to the published-sheet CSV when the key is unset.
export async function fetchAshbyWeeks(): Promise<AshbyWeek[]> {
  try {
    const res = await fetch('/api/ashby/weekly')
    if (res.ok) {
      const json = (await res.json()) as { configured?: boolean; rows?: WeeklyRow[] }
      if (json.configured && Array.isArray(json.rows)) {
        return json.rows
          .map(r => weekFromParts(r.fullLabel, r.applicants || 0, r.relevant || 0))
          .filter((r): r is AshbyWeek => r !== null)
          .sort((a, b) => a.weekOf.getTime() - b.weekOf.getTime())
      }
    }
  } catch {
    // fall through to CSV
  }
  const csv = await fetch('/api/ashby').then(r => r.text())
  return parseAshby(csv)
}

// ── small helpers ────────────────────────────────────────────────────────────
function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null
  return ((curr - prev) / prev) * 100
}
function f0(n: number) { return n.toLocaleString() }
function signed(n: number, digits = 0) { return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}` }

// ── linear regression ────────────────────────────────────────────────────────
function linReg(vals: (number | null)[]): (number | null)[] {
  const pts = vals.map((v, i) => v !== null ? [i, v] as [number, number] : null).filter(Boolean) as [number, number][]
  if (pts.length < 2) return vals.map(() => null)
  const n = pts.length
  const sumX  = pts.reduce((s, [x]) => s + x, 0)
  const sumY  = pts.reduce((s, [, y]) => s + y, 0)
  const sumXY = pts.reduce((s, [x, y]) => s + x * y, 0)
  const sumX2 = pts.reduce((s, [x]) => s + x * x, 0)
  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  const b = (sumY - m * sumX) / n
  return vals.map((v, i) => v !== null ? parseFloat((m * i + b).toFixed(2)) : null)
}

function todayLabel(): string {
  const d = new Date()
  return `${MON_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// ── delta badge ──────────────────────────────────────────────────────────────
function Delta({ pct, pts, suffix }: { pct?: number | null; pts?: number | null; suffix?: string }) {
  const val = pts ?? pct
  if (val === null || val === undefined) {
    return <span className="font-mono text-xs" style={{ color: C.dim }}>—</span>
  }
  const flat = Math.abs(val) < 0.05
  const up = val > 0
  const color = flat ? C.muted : up ? C.greenL : C.red
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight
  const text = pts !== undefined
    ? `${signed(val, 1)} pts`
    : `${signed(val, val % 1 === 0 ? 0 : 1)}%`
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-xs" style={{ color }}>
      <Icon size={13} strokeWidth={2.5} />
      {text}{suffix ? ` ${suffix}` : ''}
    </span>
  )
}

// ── scorecard tile ───────────────────────────────────────────────────────────
function Tile({
  label, value, sub, delta,
}: { label: string; value: string; sub?: string; delta?: ReactNode }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-1.5" style={CARD}>
      <span className={UPLABEL} style={{ color: C.muted }}>{label}</span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[26px] leading-none font-medium" style={{ color: C.text }}>{value}</span>
        {delta}
      </div>
      {sub && <span className="font-mono text-[11px]" style={{ color: C.dim }}>{sub}</span>}
    </div>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────
export function ExecutiveSummary({ onJump }: { onJump?: (t: 'sourcing' | 'inbound' | 'ashby') => void }) {
  const { data: weeksRes } = useSWR<{ weeks: WeekData[] }>('/api/data', jsonFetcher)
  const { data: ashbyData } = useSWR<AshbyWeek[]>('ashby-weekly:summary', fetchAshbyWeeks, { refreshInterval: 300_000 })

  const weeks: WeekData[] = weeksRes?.weeks?.length ? weeksRes.weeks : SEED_WEEKS
  const ashby = ashbyData ?? []

  // ── Outbound (latest vs prior week) ──
  const agg = weeks.map(aggregateWeek)
  const oNow = agg[agg.length - 1]
  const oPrev = agg.length > 1 ? agg[agg.length - 2] : null
  const oLabel = weeks[weeks.length - 1]?.label ?? ''

  const oReplyRate = replyRate(oNow.replies, oNow.messages)
  const oReplyRatePrev = oPrev ? replyRate(oPrev.replies, oPrev.messages) : null
  const oAcceptRate = acceptRate(oNow.accepted, oNow.invites)

  // ── Inbound / Ashby (latest vs prior week) ──
  const aNow = ashby[ashby.length - 1] ?? null
  const aPrev = ashby.length > 1 ? ashby[ashby.length - 2] : null
  const aRelRate = aNow && aNow.applicants ? (aNow.relevant / aNow.applicants) * 100 : null
  const aRelRatePrev = aPrev && aPrev.applicants ? (aPrev.relevant / aPrev.applicants) * 100 : null

  // ── combined "quality signal" trend (last 8 weeks each source) ──
  const trend = useMemo(() => {
    const oTail = weeks.slice(-8).map((w) => ({ label: w.label, replies: aggregateWeek(w).replies }))
    const aTail = ashby.slice(-8).map((r) => ({ label: r.label, relevant: r.relevant }))
    const max = Math.max(oTail.length, aTail.length)
    const out: { label: string; replies: number | null; relevant: number | null }[] = []
    for (let i = 0; i < max; i++) {
      const o = oTail[oTail.length - max + i]
      const a = aTail[aTail.length - max + i]
      out.push({
        label: a?.label ?? o?.label ?? '',
        replies: o ? o.replies : null,
        relevant: a ? a.relevant : null,
      })
    }
    const repliesTrend  = linReg(out.map(p => p.replies))
    const relevantTrend = linReg(out.map(p => p.relevant))
    return out.map((p, i) => ({ ...p, repliesTrend: repliesTrend[i], relevantTrend: relevantTrend[i] }))
  }, [weeks, ashby])

  // ── auto-narrative ���─
  const headline = useMemo(() => {
    const parts: string[] = []
    const invD = oPrev ? pctChange(oNow.invites, oPrev.invites) : null
    const repD = oPrev ? pctChange(oNow.replies, oPrev.replies) : null
    if (oPrev && invD !== null) {
      parts.push(`Outbound invites ${invD >= 0 ? 'up' : 'down'} ${Math.abs(invD).toFixed(0)}% (${f0(oNow.invites)} sent)`)
    } else {
      parts.push(`${f0(oNow.invites)} outbound invites sent`)
    }
    if (oPrev && repD !== null) {
      parts.push(`replies ${repD >= 0 ? 'up' : 'down'} ${Math.abs(repD).toFixed(0)}%`)
    }
    if (aNow && aPrev) {
      const relD = pctChange(aNow.relevant, aPrev.relevant)
      if (relD !== null) {
        parts.push(`inbound relevant applicants ${relD >= 0 ? 'up' : 'down'} ${Math.abs(relD).toFixed(0)}% (${f0(aNow.relevant)})`)
      }
    } else if (aNow) {
      parts.push(`${f0(aNow.relevant)} relevant inbound applicants`)
    }
    const joined = parts.join('; ')
    return joined.charAt(0).toUpperCase() + joined.slice(1) + '.'
  }, [oNow, oPrev, aNow, aPrev])

  return (
    <div className="flex flex-col gap-7">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-medium leading-tight" style={{ color: C.text }}>Executive summary</h1>
        <p className="mt-1 font-mono text-sm" style={{ color: C.muted }}>
          Week ending {todayLabel()} · for leadership
        </p>
      </div>

      {/* Headline narrative */}
      <div className="rounded-lg p-5 flex gap-3 items-start" style={{ ...CARD, borderLeft: `3px solid ${C.greenL}` }}>
        <Mail size={18} style={{ color: C.greenL, marginTop: 2, flexShrink: 0 }} />
        <p className="text-[15px] leading-relaxed" style={{ color: C.text }}>{headline}</p>
      </div>

      {/* Scorecard */}
      <div>
        <div className={`${UPLABEL} mb-2.5`} style={{ color: C.dim }}>
          Outbound sourcing · week of {oLabel}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Invites sent" value={f0(oNow.invites)}
            delta={<Delta pct={oPrev ? pctChange(oNow.invites, oPrev.invites) : null} />}
            sub={oPrev ? `${signed(oNow.invites - oPrev.invites)} vs last week` : 'first week'} />
          <Tile label="Replies" value={f0(oNow.replies)}
            delta={<Delta pct={oPrev ? pctChange(oNow.replies, oPrev.replies) : null} />}
            sub={oPrev ? `${signed(oNow.replies - oPrev.replies)} vs last week` : 'first week'} />
          <Tile label="Reply rate" value={`${fmt1(oReplyRate)}%`}
            delta={<Delta pts={oReplyRatePrev !== null ? oReplyRate - oReplyRatePrev : null} />}
            sub="replies / messages" />
          <Tile label="Accept rate" value={`${fmt1(oAcceptRate)}%`} sub="connections accepted" />
        </div>
      </div>

      {aNow && (
        <div>
          <div className={`${UPLABEL} mb-2.5`} style={{ color: C.dim }}>
            Inbound applicants · week of {aNow.label}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Applicants" value={f0(aNow.applicants)}
              delta={<Delta pct={aPrev ? pctChange(aNow.applicants, aPrev.applicants) : null} />}
              sub={aPrev ? `${signed(aNow.applicants - aPrev.applicants)} vs last week` : 'first week'} />
            <Tile label="Relevant" value={f0(aNow.relevant)}
              delta={<Delta pct={aPrev ? pctChange(aNow.relevant, aPrev.relevant) : null} />}
              sub={aPrev ? `${signed(aNow.relevant - aPrev.relevant)} vs last week` : 'first week'} />
            <Tile label="Relevance rate" value={aRelRate !== null ? `${fmt1(aRelRate)}%` : '—'}
              delta={<Delta pts={aRelRate !== null && aRelRatePrev !== null ? aRelRate - aRelRatePrev : null} />}
              sub="relevant / applicants" />
            <Tile label="Quality pipeline" value={f0(oNow.replies + aNow.relevant)}
              sub="replies + relevant apps" />
          </div>
        </div>
      )}

      {/* Quality-signal trend */}
      <div className="rounded-lg p-5" style={CARD}>
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <span className={UPLABEL} style={{ color: C.muted }}>Quality signal — last 8 weeks</span>
          <span className="font-mono text-[11px]" style={{ color: C.dim }}>outbound replies vs inbound relevant applicants</span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={trend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#484f58', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#484f58', fontSize: 11, fontFamily: 'var(--font-dm-mono)' }} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              contentStyle={{ backgroundColor: '#161b22', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontFamily: 'var(--font-dm-mono)', fontSize: 12 }}
              labelStyle={{ color: '#e6edf3' }}
              itemStyle={{ color: '#8b949e' }}
              formatter={(v: number, name: string) => [v?.toLocaleString() ?? '—', name]}
            />
            <Legend wrapperStyle={{ fontFamily: 'var(--font-dm-mono)', fontSize: 11, color: '#8b949e', paddingTop: 8 }} />
            {/* Faded linear-regression trendlines painted first so bars render on top */}
            <Line type="linear" dataKey="repliesTrend"  stroke={C.greenL} strokeWidth={1.5} dot={false} opacity={0.3} connectNulls legendType="none" tooltipType="none" />
            <Line type="linear" dataKey="relevantTrend" stroke={C.blue}   strokeWidth={1.5} dot={false} opacity={0.3} connectNulls legendType="none" tooltipType="none" />
            {/* Hoverable bars */}
            <Bar dataKey="replies"  name="Outbound replies" fill={C.greenL} radius={[2,2,0,0]} opacity={0.75} />
            <Bar dataKey="relevant" name="Inbound relevant" fill={C.blue}   radius={[2,2,0,0]} opacity={0.75} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {onJump && (
        <div className="flex gap-2 flex-wrap pb-2">
          {([['sourcing', 'Outbound detail'], ['inbound', 'Inbound postings'], ['ashby', 'Ashby detail']] as const).map(([k, label]) => (
            <button key={k} onClick={() => onJump(k)}
              className="font-mono text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{ color: C.muted, backgroundColor: C.surface, border: `1px solid ${C.border}` }}>
              {label} →
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
