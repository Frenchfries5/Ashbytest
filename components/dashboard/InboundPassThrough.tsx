'use client'

import useSWR from 'swr'

// Bridges the two halves of the inbound story: the manual LinkedIn posting tracker (ads, views,
// LinkedIn-reported applicants) and Ashby (applications that actually landed in the ATS, and what
// became of them).
//
// Every step is LINKEDIN-ATTRIBUTED. That matters: the req also receives referrals, booking-link
// and direct applications, and folding those in would make the step-to-step percentage look like a
// LinkedIn conversion when it isn't. The all-channel total for the req is in the Ashby detail
// sub-tab instead.
//
// Still not a per-post join: the two systems share no key, posts overlap on ~40% of live days, and
// applications arrive after a post goes live — so no single post can be credited with a hire.

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface Posting { date_posted: string | null; views: number | null; applicants: number | null }
interface Scope { applications: number; advanced: number; hired: number }
interface Funnel {
  configured: boolean
  dataStart: string | null
  linkedin: Scope | null
  all: Scope | null
}

const C = {
  text: 'var(--ds-text)', muted: 'var(--ds-muted)', dim: 'var(--ds-dim)',
  green: 'var(--ds-green-light)', blue: 'var(--ds-blue)', border: 'var(--ds-border)', surface: 'var(--ds-surface)',
}
const CARD = { backgroundColor: C.surface, border: `1px solid ${C.border}`, borderRadius: 10 } as const
const UPLABEL = 'font-mono text-[11px] uppercase tracking-wider block'

function Step({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex-1 min-w-[130px] px-4 py-3">
      <span className={UPLABEL} style={{ color: C.muted }}>{label}</span>
      <div className="font-mono text-[22px] leading-none font-medium mt-1.5" style={{ color: color ?? C.text }}>{value}</div>
      {sub && <div className="font-mono text-[10.5px] mt-1.5" style={{ color: C.dim }}>{sub}</div>}
    </div>
  )
}

export function InboundPassThrough() {
  const { data: postingsRes } = useSWR<{ postings: Posting[] }>('/api/inbound/postings', fetcher)
  const { data: funnel } = useSWR<Funnel>('/api/ashby/inbound-funnel', fetcher, { refreshInterval: 300_000 })

  const li = funnel?.linkedin
  if (!funnel?.configured || !li || !postingsRes?.postings) return null

  // Only count postings from the month Ashby's history begins, so both sides cover the same window.
  const startMonth = funnel.dataStart ? funnel.dataStart.slice(0, 7) : null
  const inWindow = (postingsRes.postings ?? []).filter(
    (p) => p.date_posted && (!startMonth || p.date_posted.slice(0, 7) >= startMonth)
  )
  const views = inWindow.reduce((s, p) => s + (Number(p.views) || 0), 0)
  const liApplicants = inWindow.reduce((s, p) => s + (Number(p.applicants) || 0), 0)

  const conversion = liApplicants ? (li.applications / liApplicants) * 100 : null
  const windowLabel = funnel.dataStart
    ? new Date(funnel.dataStart).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null
  const allApps = funnel.all?.applications ?? null

  return (
    <div>
      <h2 className={`${UPLABEL} mb-3`} style={{ color: C.muted }}>LinkedIn Ads → Applications → Outcomes</h2>
      <div className="rounded-lg" style={CARD}>
        <div className="flex flex-wrap divide-x" style={{ borderColor: C.border }}>
          <Step label="Post views" value={views.toLocaleString()} sub={`${inWindow.length} posts`} />
          <Step label="LinkedIn applicants" value={liApplicants.toLocaleString()} sub="reported by LinkedIn" color={C.blue} />
          <Step
            label="Applications received"
            value={li.applications.toLocaleString()}
            sub={conversion != null ? `${conversion.toFixed(0)}% of LinkedIn applicants` : 'in Ashby'}
            color={C.blue}
          />
          <Step label="Advanced past review" value={li.advanced.toLocaleString()} sub="estimated — see note" />
          <Step label="Hired" value={li.hired.toLocaleString()} sub="LinkedIn-sourced" color={C.green} />
        </div>
      </div>
      <p className="font-mono text-[10.5px] mt-2 leading-relaxed" style={{ color: C.dim }}>
        Every step counts LinkedIn-attributed candidates only, so the percentage is a real conversion.
        {allApps != null ? ` This req received ${allApps.toLocaleString()} applications across all channels — that wider total is under Ashby detail.` : ''}
        {windowLabel ? ` Both sides start ${windowLabel}, where Ashby history begins.` : ''}
        {' '}First two figures are LinkedIn&rsquo;s own post analytics; the rest are Ashby.
        &ldquo;Advanced past review&rdquo; is inferred from Ashby stage and archive-reason data rather than a logged
        screening event, so treat it as an estimate. No individual post can be credited with a specific hire.
      </p>
    </div>
  )
}
