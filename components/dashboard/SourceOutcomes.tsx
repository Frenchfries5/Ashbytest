'use client'

import useSWR from 'swr'

const jsonFetcher = (url: string) => fetch(url).then(r => r.json())
const C = { dim: 'var(--ds-dim)', muted: 'var(--ds-muted)', blue: 'var(--ds-blue)', greenL: 'var(--ds-green-light)', amber: 'var(--ds-amber)' }
function f1(n: number) { return n.toFixed(1) }
// ── Source → outcome (from the Ashby cache) ────────────────────────────────────
// The postings tracker stops at "relevant". Ashby knows who actually got hired and which channel
// each application arrived through, so this closes the loop — at channel level, since the two
// systems share no join key.

interface SourceOutcome {
  source: string
  applications: number
  advanced: number
  hired: number
  hireRate: number
}

// Local copies of the styles the main component keeps as function-scoped consts.
const SO_UPLABEL = 'font-mono text-[11px] uppercase tracking-wider block'
const SO_CARD = { backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10 } as const

export function SourceOutcomes() {
  const { data } = useSWR<{ configured: boolean; sources: SourceOutcome[]; dataStart: string | null }>(
    '/api/ashby/sources', jsonFetcher, { refreshInterval: 300_000 }
  )
  if (!data?.configured || !data.sources?.length) return null

  // Trim the long tail of one-off sources — they add rows without adding signal.
  const MIN_APPS = 5
  const rows = data.sources.filter(s => s.applications >= MIN_APPS)
  const hidden = data.sources.length - rows.length
  const maxApps = Math.max(...rows.map(s => s.applications), 1)
  const start = data.dataStart
    ? new Date(data.dataStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  return (
    <div>
      <h2 className={`${SO_UPLABEL} mb-3`} style={{ color: 'var(--ds-muted)' }}>Where Applicants End Up (by channel)</h2>
      <div className="rounded-lg overflow-hidden" style={SO_CARD}>
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Channel</th>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Volume</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Applications</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Past screen</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hired</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hire %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.source} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--ds-border)' : 'none' }}>
                <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--ds-text)' }}>{s.source}</td>
                <td className="px-4 py-2.5" style={{ minWidth: 90 }}>
                  <div className="h-1.5 rounded" style={{ width: `${(s.applications / maxApps) * 100}%`, background: C.blue, opacity: 0.7 }} />
                </td>
                <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-text)' }}>{s.applications.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-muted)' }}>{s.advanced.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-text)' }}>{s.hired}</td>
                <td className="px-4 py-2.5 text-right font-medium" style={{ color: s.hireRate >= 5 ? C.greenL : s.hireRate >= 1 ? C.amber : '#f87171' }}>
                  {f1(s.hireRate)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
        From Ashby{start ? `, which has application history from ${start} onward` : ''} — so this covers a shorter
        window than the posting history above. Channel-level attribution: an individual post can&rsquo;t be tied to a
        specific hire.{hidden > 0 ? ` ${hidden} channel${hidden === 1 ? '' : 's'} with under ${MIN_APPS} applications hidden.` : ''}
      </p>
    </div>
  )
}
