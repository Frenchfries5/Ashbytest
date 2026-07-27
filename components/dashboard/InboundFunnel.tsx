'use client'

import useSWR from 'swr'

// ONE inbound funnel. Every application counts identically regardless of how it arrived — a
// LinkedIn job slot, a manual LinkedIn post, a direct apply, a referral link — because they're the
// same event and Ashby records all of them. Channel is a breakdown (see Channels), not a separate
// funnel, so there's a single definition of applications / screened / advanced / hired.
//
// Post views sit apart from the funnel on purpose: they only exist for logged LinkedIn posts, so
// they can't be a denominator for applications that also arrive through other channels.

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Funnel {
  configured: boolean
  applications?: number
  screened?: number
  advanced?: number
  hired?: number
  dataStart?: string | null
  reqs?: string[]
}
interface Posting { date_posted: string | null; views: number | null }

const C = {
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green-light)', blue: 'var(--ds-blue)', border: 'var(--ds-border)', surface: 'var(--ds-surface)',
}
const CARD = { backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 } as const
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider block'

function Step({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex-1 min-w-[132px] px-4 py-3">
      <span className={UPLABEL} style={{ color: C.muted }}>{label}</span>
      <div className="font-mono text-[22px] leading-none font-medium mt-1.5" style={{ color: color ?? C.text }}>{value}</div>
      {sub && <div className="font-mono text-[10.5px] mt-1.5" style={{ color: C.dim }}>{sub}</div>}
    </div>
  )
}

export function InboundFunnel({ role = 'all' }: { role?: string }) {
  const { data: f } = useSWR<Funnel>(`/api/ashby/inbound-funnel?role=${encodeURIComponent(role)}`, fetcher, { refreshInterval: 300_000 })
  const { data: postingsRes } = useSWR<{ postings: Posting[] }>('/api/inbound/postings', fetcher)

  // Read defensively: a cached response from an older shape must not crash the page.
  const applications = f?.applications ?? 0
  const screened = f?.screened ?? 0
  const advanced = f?.advanced ?? 0
  const hired = f?.hired ?? 0
  if (!f?.configured || !applications) return null

  const of = (n: number) => `${((n / applications) * 100).toFixed(0)}% of applications`
  const startLabel = f.dataStart
    ? new Date(f.dataStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null

  // Reach context: views only exist on logged LinkedIn posts, and only from the window Ashby covers.
  const startMonth = f.dataStart ? f.dataStart.slice(0, 7) : null
  const posts = (postingsRes?.postings ?? []).filter(
    (p) => p.date_posted && (!startMonth || p.date_posted.slice(0, 7) >= startMonth)
  )
  const views = posts.reduce((s, p) => s + (Number(p.views) || 0), 0)

  const uniqueReqs = [...new Set(f.reqs ?? [])]

  return (
    <div>
      <h2 className={`${UPLABEL} mb-3`} style={{ color: C.muted }}>Inbound Funnel</h2>
      <div className="rounded-lg" style={CARD}>
        <div className="flex flex-wrap divide-x" style={{ borderColor: C.border }}>
          <Step label="Applications" value={applications.toLocaleString()} sub="all channels" color={C.blue} />
          <Step label="Screened" value={screened.toLocaleString()} sub={of(screened)} />
          <Step label="Advanced past screen" value={advanced.toLocaleString()} sub={of(advanced)} />
          <Step label="Hired" value={hired.toLocaleString()} sub={of(hired)} color={C.green} />
        </div>
      </div>
      <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
        One definition per step, pooled across every inbound channel — LinkedIn job slots, manual LinkedIn posts,
        direct applies and referrals all count the same. Channel-level splits are under Channels.
        {/* titles contain commas, so join with a middot rather than another comma */}
        Covers {uniqueReqs.length} sales/broker req{uniqueReqs.length === 1 ? '' : 's'} ({uniqueReqs.join(' · ')})
        {startLabel ? `, from ${startLabel} when Ashby history begins` : ''}.
        Screened and advanced come from interview events rather than current stage, so archived candidates still
        count for how far they actually got.
        {views > 0 ? ` Separately, ${views.toLocaleString()} post views across ${posts.length} logged LinkedIn posts — reach for that channel only, which is why it isn't a step above.` : ''}
      </p>
    </div>
  )
}
