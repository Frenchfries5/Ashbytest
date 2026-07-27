'use client'

import useSWR from 'swr'

// Channel breakdown of the SAME pooled funnel shown up top — same endpoint, same scope, same role
// filter — so the channel rows always add up to the funnel totals. (It previously read an org-wide
// sources endpoint, which meant these numbers didn't reconcile with the funnel and ignored the
// role filter.)

const jsonFetcher = (url: string) => fetch(url).then(r => r.json())
const C = { dim: 'var(--ds-dim)', muted: 'var(--ds-muted)', blue: 'var(--ds-blue)', greenL: 'var(--ds-green-light)', amber: 'var(--ds-amber)' }
function f1(n: number) { return n.toFixed(1) }

interface ChannelRow {
  channel: string
  applications: number
  screened: number
  advanced: number
  hired: number
}

const SO_UPLABEL = 'font-mono text-[11px] uppercase tracking-wider block'
const SO_CARD = { backgroundColor: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 10 } as const

export function SourceOutcomes({ role = 'all' }: { role?: string }) {
  const { data } = useSWR<{ configured: boolean; channels?: ChannelRow[]; dataStart?: string | null }>(
    `/api/ashby/inbound-funnel?role=${encodeURIComponent(role)}`, jsonFetcher, { refreshInterval: 300_000 }
  )
  const channels = data?.channels ?? []
  if (!data?.configured || !channels.length) return null

  // Trim the long tail of one-off channels — they add rows without adding signal.
  const MIN_APPS = 5
  const rows = channels.filter(c => c.applications >= MIN_APPS)
  const hidden = channels.length - rows.length
  const maxApps = Math.max(...rows.map(c => c.applications), 1)
  const start = data.dataStart
    ? new Date(data.dataStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  const hireColor = (pct: number) => (pct >= 5 ? C.greenL : pct >= 1 ? C.amber : '#f87171')

  return (
    <div>
      <h2 className={`${SO_UPLABEL} mb-3`} style={{ color: 'var(--ds-muted)' }}>By Channel</h2>
      <div className="rounded-lg overflow-hidden" style={SO_CARD}>
        <table className="w-full text-left font-mono text-xs">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--ds-border)' }}>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Channel</th>
              <th className="px-4 py-3 font-normal" style={{ color: C.dim }}>Volume</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Applications</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Screened</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Advanced</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hired</th>
              <th className="px-4 py-3 font-normal text-right" style={{ color: C.dim }}>Hire %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const hireRate = c.applications ? (c.hired / c.applications) * 100 : 0
              return (
                <tr key={c.channel} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--ds-border)' : 'none' }}>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--ds-text)' }}>{c.channel}</td>
                  <td className="px-4 py-2.5" style={{ minWidth: 90 }}>
                    <div className="h-1.5 rounded" style={{ width: `${(c.applications / maxApps) * 100}%`, background: C.blue, opacity: 0.7 }} />
                  </td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-text)' }}>{c.applications.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-muted)' }}>{c.screened.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-muted)' }}>{c.advanced.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right" style={{ color: 'var(--ds-text)' }}>{c.hired}</td>
                  <td className="px-4 py-2.5 text-right font-medium" style={{ color: hireColor(hireRate) }}>{f1(hireRate)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
        Same pooled funnel as above, split by how each application arrived — so these rows add up to the funnel
        totals and follow the role filter.{start ? ` From ${start}, when Ashby application history begins.` : ''}
        {hidden > 0 ? ` ${hidden} channel${hidden === 1 ? '' : 's'} with under ${MIN_APPS} applications hidden.` : ''}
      </p>
    </div>
  )
}
