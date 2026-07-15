'use client'

import { useState, useMemo } from 'react'
import useSWR, { mutate } from 'swr'
import { WeekData, RecruiterRow, SEED_WEEKS, aggregateWeek, acceptRate, replyRate, fmt1 } from '@/lib/types'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import { Trash2, Copy, Check, Mail } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function parseCSV(raw: string): RecruiterRow[] {
  const lines = raw.trim().split('\n')
  const rows: RecruiterRow[] = []
  // skip header (first line)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',').map((c) => c.trim())
    // CSV format: Name, Email, Role, Invites Sent, Accepted, Messages, Replies, Greetings, Profile Views, Active Campaigns, Saved Hours
    // index:       0      1      2     3             4         5         6        7           8              9                 10
    const name = cols[0] ?? ''
    const role = cols[2] ?? ''
    if (!name || role.toLowerCase() === 'total') continue
    const invites = parseInt(cols[3] ?? '0', 10) || 0
    const accepted = parseInt(cols[4] ?? '0', 10) || 0
    const messages = parseInt(cols[5] ?? '0', 10) || 0
    const replies = parseInt(cols[6] ?? '0', 10) || 0
    const campaigns = parseInt(cols[9] ?? '0', 10) || 0
    rows.push({ name, invites, accepted, messages, replies, campaigns })
  }
  return rows
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ── Ashby parser (matches AshbyDashboard) ────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
}
interface AshbyWeek { label: string; applicants: number; relevant: number }
function parseAshbyCSV(raw: string): AshbyWeek[] {
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
    const m = (cols[0] ?? '').match(/^(\w+)\s+(\d+),?\s+(\d{4})/)
    if (!m) continue
    const [, mon, day, year] = m
    const weekOf = new Date(parseInt(year), MONTH_MAP[mon] ?? 0, parseInt(day))
    rows.push({ label: `${MONTHS[MONTH_MAP[mon] ?? 0]} ${parseInt(day)}`, applicants: parseInt(cols[1]) || 0, relevant: parseInt(cols[2]) || 0, weekOf } as AshbyWeek & { weekOf: Date })
  }
  return (rows as (AshbyWeek & { weekOf: Date })[]).sort((a, b) => a.weekOf.getTime() - b.weekOf.getTime())
}

function todayLabel(): string {
  const d = new Date()
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
function f0(n: number) { return n.toLocaleString() }
function signed(n: number, digits = 0) { return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}` }

function parseLabelFromFilename(filename: string): string | null {
  // team-activity-report-YYYY-MM-DD-to-YYYY-MM-DD.csv
  const match = filename.match(/(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const [, startStr, endStr] = match
  const [startY, startM, startD] = startStr.split('-').map(Number)
  const [, endM, endD] = endStr.split('-').map(Number)
  const startMon = MONTHS[startM - 1]
  const endMon = MONTHS[endM - 1]
  // e.g. "May 11 – May 17, 2026"
  return `${startMon} ${startD} \u2013 ${endMon} ${endD}, ${startY}`
}

export default function AdminPage() {
  const [password, setPassword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [parsedLabel, setParsedLabel] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null
    setFile(selected)
    setParsedLabel(selected ? parseLabelFromFilename(selected.name) : null)
  }

  const { data } = useSWR<{ weeks: WeekData[] }>('/api/data', fetcher)
  const weeks = data?.weeks ?? []

  // ── Friday email ──────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false)
  const { data: ashbyCsv } = useSWR<string>('/api/ashby', (url: string) => fetch(url).then(r => r.text()), { refreshInterval: 300_000 })

  const sourceWeeks = weeks.length ? weeks : SEED_WEEKS
  const agg = sourceWeeks.map(aggregateWeek)
  const oNow = agg[agg.length - 1]
  const oPrev = agg.length > 1 ? agg[agg.length - 2] : null
  const oLabel = sourceWeeks[sourceWeeks.length - 1]?.label ?? ''
  const oReplyRate = replyRate(oNow.replies, oNow.messages)
  const oReplyRatePrev = oPrev ? replyRate(oPrev.replies, oPrev.messages) : null
  const oAcceptRate = acceptRate(oNow.accepted, oNow.invites)

  const ashby = useMemo(() => (ashbyCsv ? parseAshbyCSV(ashbyCsv) : []), [ashbyCsv])
  const aNow = ashby[ashby.length - 1] ?? null
  const aPrev = ashby.length > 1 ? ashby[ashby.length - 2] : null
  const aRelRate = aNow?.applicants ? (aNow.relevant / aNow.applicants) * 100 : null
  const aRelRatePrev = aPrev?.applicants ? (aPrev.relevant / aPrev.applicants) * 100 : null

  const emailText = useMemo(() => {
    const L: string[] = []
    L.push(`Recruiting Pipeline — Weekly Update (${todayLabel()})`)
    L.push('')
    L.push(`OUTBOUND SOURCING  (week of ${oLabel})`)
    L.push(`  Invites sent      ${f0(oNow.invites)}${oPrev ? `   (${signed(oNow.invites - oPrev.invites)} WoW)` : ''}`)
    L.push(`  Replies           ${f0(oNow.replies)}${oPrev ? `   (${signed(oNow.replies - oPrev.replies)} WoW)` : ''}`)
    L.push(`  Reply rate        ${fmt1(oReplyRate)}%${oReplyRatePrev !== null ? `   (${signed(oReplyRate - oReplyRatePrev, 1)} pts WoW)` : ''}`)
    L.push(`  Accept rate       ${fmt1(oAcceptRate)}%`)
    if (aNow) {
      L.push('')
      L.push(`INBOUND APPLICANTS  (week of ${aNow.label})`)
      L.push(`  Applicants        ${f0(aNow.applicants)}${aPrev ? `   (${signed(aNow.applicants - aPrev.applicants)} WoW)` : ''}`)
      L.push(`  Relevant          ${f0(aNow.relevant)}${aPrev ? `   (${signed(aNow.relevant - aPrev.relevant)} WoW)` : ''}`)
      if (aRelRate !== null) {
        L.push(`  Relevance rate    ${fmt1(aRelRate)}%${aRelRatePrev !== null ? `   (${signed(aRelRate - aRelRatePrev, 1)} pts WoW)` : ''}`)
      }
    }
    L.push('')
    L.push('Full dashboard: [link]')
    return L.join('\n')
  }, [oLabel, oNow, oPrev, oReplyRate, oReplyRatePrev, oAcceptRate, aNow, aPrev, aRelRate, aRelRatePrev])

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(emailText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* blocked in sandboxed iframe */ }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!password || !file || !parsedLabel) {
      toast.error('Password and CSV file are required.')
      return
    }
    const csv = await file.text()
    const rows = parseCSV(csv)
    if (!rows.length) {
      toast.error('No valid rows found in CSV.')
      return
    }
    const label = parsedLabel
    setSubmitting(true)
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, label, rows }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      toast.success(`Week "${label}" uploaded successfully.`)
      setFile(null)
      setParsedLabel(null)
      mutate('/api/data')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: number, weekLabel: string) {
    if (!password) {
      toast.error('Enter your password above first.')
      return
    }
    setDeleting(id)
    try {
      const res = await fetch(`/api/weeks/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Delete failed')
      toast.success(`Week "${weekLabel}" deleted.`)
      mutate('/api/data')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeleting(null)
    }
  }

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--ds-bg)',
    border: '1px solid var(--ds-border)',
    color: 'var(--ds-text)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    fontFamily: 'var(--font-dm-mono)',
    outline: 'none',
    width: '100%',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-dm-mono)',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--ds-muted)',
    display: 'block',
    marginBottom: 6,
  }

  return (
    <div style={{ backgroundColor: 'var(--ds-bg)', minHeight: '100vh' }}>
      <Toaster theme="dark" position="top-right" />

      {/* Topbar */}
      <header
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: 'var(--ds-border)', backgroundColor: 'var(--ds-surface)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>Coverdash</span>
          <span style={{ color: 'var(--ds-dim)' }}>/</span>
          <span className="text-sm" style={{ color: 'var(--ds-muted)' }}>admin</span>
        </div>
        <a href="/" className="font-mono text-xs" style={{ color: 'var(--ds-muted)' }}>
          ← Dashboard
        </a>
      </header>

      <main className="max-w-xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--ds-text)' }}>
          Upload week
        </h1>
        <p className="font-mono text-xs mb-8" style={{ color: 'var(--ds-muted)' }}>
          Upload a LinkedIn team activity CSV export to add a new week of sourcing data.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label style={labelStyle}>Admin Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>CSV File</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                paddingTop: 7,
              }}
            />
            {file && (
              <div className="mt-2 flex items-center gap-2">
                <span className="font-mono text-xs" style={{ color: 'var(--ds-dim)' }}>Detected label:</span>
                {parsedLabel ? (
                  <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--ds-surface)', color: 'var(--ds-green-light)', border: '1px solid var(--ds-border)' }}>
                    {parsedLabel}
                  </span>
                ) : (
                  <span className="font-mono text-xs" style={{ color: '#f87171' }}>
                    Could not parse date range from filename
                  </span>
                )}
              </div>
            )}
            <p className="mt-2 font-mono text-xs" style={{ color: 'var(--ds-dim)' }}>
              Expected filename: team-activity-report-YYYY-MM-DD-to-YYYY-MM-DD.csv
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="py-2.5 px-5 rounded text-sm font-medium transition-opacity disabled:opacity-50"
            style={{ backgroundColor: 'var(--ds-green)', color: '#fff' }}
          >
            {submitting ? 'Uploading…' : 'Upload week'}
          </button>
        </form>

        {/* Saved weeks */}
        {weeks.length > 0 && (
          <div className="mt-12">
            <h2 className="font-mono text-xs uppercase tracking-wide mb-3" style={{ color: 'var(--ds-muted)' }}>
              Saved Weeks
            </h2>
            <div className="flex flex-col gap-2">
              {weeks.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between px-4 py-3 rounded-lg"
                  style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
                >
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>{w.label}</span>
                    <span className="font-mono text-xs ml-3" style={{ color: 'var(--ds-dim)' }}>
                      {w.rows.length} recruiter{w.rows.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => w.id && handleDelete(w.id, w.label)}
                    disabled={deleting === w.id}
                    className="p-1.5 rounded transition-colors disabled:opacity-40"
                    style={{ color: 'var(--ds-dim)' }}
                    title="Delete week"
                    aria-label={`Delete week ${w.label}`}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#f87171')}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--ds-dim)')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* Friday email */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Mail size={15} style={{ color: 'var(--ds-green-light)' }} />
              <h2 className="font-mono text-xs uppercase tracking-wide" style={{ color: 'var(--ds-muted)' }}>
                Friday email
              </h2>
            </div>
            <button
              onClick={copyEmail}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs transition-colors"
              style={{
                color: copied ? 'var(--ds-green-light)' : 'var(--ds-text)',
                backgroundColor: 'var(--ds-surface)',
                border: `1px solid ${copied ? 'var(--ds-green)' : 'var(--ds-border)'}`,
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy to clipboard'}
            </button>
          </div>
          <div
            className="rounded-lg overflow-hidden"
            style={{ backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}
          >
            <pre
              className="px-5 py-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap overflow-x-auto"
              style={{ color: 'var(--ds-text)' }}
            >{emailText}</pre>
          </div>
        </div>
      </main>
    </div>
  )
}
