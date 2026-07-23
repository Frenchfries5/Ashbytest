import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { graphMailConfigured, sendGraphMail } from '@/lib/graph-mail'
import { isAdminRequest } from '@/lib/admin-auth'
import { getWeeklySourcing } from '@/lib/sourcing'
import { getAshbyWeeklyRows } from '@/lib/ashby-weekly'
import { getWeeklyHireCounts } from '@/lib/ashby-hires'
import { getRecruiterScreensScorecard } from '@/lib/ashby-interviews'
import { getPipelineOutcomes } from '@/lib/ashby'
import {
  parseAshbyWeeks, computeOutboundScorecard, computeInboundScorecard,
  computeHiresScorecard, buildHeadline,
} from '@/lib/executive-summary'
import { renderWeeklySummaryEmail } from '@/lib/email/weekly-summary-template'

export const dynamic = 'force-dynamic'
// Bounds the deployed function; the Ashby pulls (hires + offer-stage) are the slow part.
export const maxDuration = 60

// Optional cron protection, mirroring /api/meetalfred/sync. If CRON_SECRET is set, GET callers
// must present it (Vercel Cron sends `Authorization: Bearer <secret>`; `?secret=` also works).
// If unset, GET is open — acceptable for an internal tool, but set it before relying on cron.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  if (req.nextUrl.searchParams.get('secret') === secret) return true
  return false
}

function weekEndingLabel(): string {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const d = new Date()
  return `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

// Gather the same data the Executive Summary tab shows and render the email HTML. No sending,
// no recipients, no mail send — used by both the send path and the ?preview branch.
async function buildEmail() {
  const [weeks, ashbyRes, hireRes, pipelineOutcomes, recruiterScreens] = await Promise.all([
    getWeeklySourcing(),
    getAshbyWeeklyRows(),
    getWeeklyHireCounts(),
    getPipelineOutcomes(),
    getRecruiterScreensScorecard(),
  ])

  const outbound = computeOutboundScorecard(weeks)
  const inbound = ashbyRes.configured ? computeInboundScorecard(parseAshbyWeeks(ashbyRes.rows)) : null
  const hires = computeHiresScorecard(hireRes.weeks)
  const headline = buildHeadline(outbound, inbound, hires)

  return renderWeeklySummaryEmail({
    headline,
    weekEnding: weekEndingLabel(),
    outbound,
    inbound,
    recruiterScreens,
    hires,
    growthPipeline: pipelineOutcomes?.growthPipeline ?? null,
  })
}

async function sendWeeklyEmail() {
  if (!graphMailConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Microsoft Graph mail is not configured (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER)' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Active recipients.
  const { data: recData, error: recErr } = await supabase
    .from('email_recipients')
    .select('email')
    .eq('active', true)
  if (recErr) {
    return NextResponse.json({ ok: false, error: recErr.message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  const recipients = (recData ?? []).map((r) => r.email as string).filter(Boolean)
  if (recipients.length === 0) {
    // Legitimate empty state, not a failure.
    return NextResponse.json({ ok: true, sent: 0, recipients: 0 }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const { subject, html } = await buildEmail()

  try {
    await sendGraphMail({ subject, html, bcc: recipients })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ ok: true, sent: recipients.length, recipients: recipients.length }, { headers: { 'Cache-Control': 'no-store' } })
}

// GET = Vercel Cron (Friday 4pm ET) sends; `?preview=1` renders the HTML without sending.
// Both gated by CRON_SECRET (open when unset).
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  try {
    if (req.nextUrl.searchParams.get('preview')) {
      const { html } = await buildEmail()
      return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
    }
    return await sendWeeklyEmail()
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

// POST = manual "Send now" from /admin. Higher-stakes (sends real email), so gated by the admin
// session rather than the cron secret.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return await sendWeeklyEmail()
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
