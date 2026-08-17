// Plain HTML email builder for the weekly Executive Summary. Table-based layout with inline
// styles and static hex colors — email clients don't support flex/grid or CSS variables.
// Mirrors the Executive Summary tab's blocks: the narrative sentence + the same six hero numbers
// in the same order (delta vs last week). The trend chart can't come along (SVG is stripped by
// email clients) — a link to the dashboard covers that. Fed by lib/executive-summary.ts, so the
// numbers stay in lockstep with the tab.

import type { OutboundScorecard, HiresScorecard } from '@/lib/executive-summary'

// Named pipeline activity for the week — the part a weekly read actually wants: who moved, to
// what stage, when, and how they scored. Aggregate rates live on the dashboard.
export interface RatingShape { latest: number | null; history: number[]; count: number }

export interface WeeklyDigest {
  reqs: string[]
  newApplications: number
  screened: { name: string; at: string; rating: RatingShape }[]
  movements: { name: string; stage: string; at: string; earlier: { stage: string; at: string }[]; rating: RatingShape }[]
  ratings: { average: number | null; count: number; distribution: Record<string, number> }
}

export interface WeeklySummaryData {
  headline: string
  weekEnding: string // human label, e.g. "Jul 18, 2026"
  siteUrl: string | null
  feedbackPrompt: boolean // show the "we'd love your feedback" callout at the top
  outbound: OutboundScorecard
  growthPipeline: number | null
  // Recruiter screens + moved forward: Megan, last completed week (matches the tab's chips).
  screens: { value: number; prev: number | null }
  movedForward: { value: number; prev: number | null }
  hires: HiresScorecard
  digest: WeeklyDigest | null
}

// Light palette. HTML email dark themes render inconsistently — Outlook in particular applies
// its own color inversion — so the email is intentionally light (renders cleanly in every client,
// including dark mode), even though the dashboard itself is dark.
const COL = {
  bg: '#f0f2f5', surface: '#ffffff', border: '#e2e5ea',
  text: '#1a1f28', muted: '#5c6672', dim: '#8a929c',
  green: '#1a9e6e',
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function num(n: number): string { return n.toLocaleString() }

// Signed "+N vs last week" caption; null prev (first week / no data) → no caption.
function deltaSub(curr: number, prev: number | null): string | undefined {
  if (prev === null) return undefined
  const d = curr - prev
  return `${d >= 0 ? '+' : ''}${d} vs last week`
}

interface TileData { label: string; value: string; sub?: string }

function tile(t: TileData): string {
  return `
    <td valign="top" width="50%" style="padding:6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.surface};border:1px solid ${COL.border};border-radius:10px;">
        <tr><td style="padding:14px 16px;">
          <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:${COL.muted};">${esc(t.label)}</div>
          <div style="font-family:monospace;font-size:26px;font-weight:500;color:${COL.text};margin-top:6px;">${esc(t.value)}</div>
          ${t.sub ? `<div style="font-family:monospace;font-size:11px;color:${COL.dim};margin-top:6px;">${esc(t.sub)}</div>` : ''}
        </td></tr>
      </table>
    </td>`
}

// Lay tiles out two-per-row.
function tileGrid(tiles: TileData[]): string {
  const rows: string[] = []
  for (let i = 0; i < tiles.length; i += 2) {
    const pair = [tiles[i], tiles[i + 1]].filter(Boolean) as TileData[]
    rows.push(`<tr>${pair.map(tile).join('')}${pair.length === 1 ? '<td width="50%"></td>' : ''}</tr>`)
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`
}

export function renderWeeklySummaryEmail(data: WeeklySummaryData): { subject: string; html: string } {
  const { outbound: o, hires: h, growthPipeline, siteUrl, feedbackPrompt, digest } = data

  const RATING_LABEL: Record<string, string> = { '4': 'Strong yes', '3': 'Yes', '2': 'No', '1': 'Strong no' }
  // 4/3 advance, 2/1 don't — colour so a low-scoring advance is visible at a glance.
  const ratingColor = (n: number) => (n >= 4 ? '#1a9e6e' : n === 3 ? '#2f6fd0' : n === 2 ? '#b8791a' : '#c0392b')
  // The whole scorecard chain, oldest first — "2 &rarr; 3 &rarr; 4 Strong yes" — each score coloured
  // on its own scale so the direction of travel across scorecards is legible. Only the current score
  // carries the word label. `sep` joins them; `label` appends the trailing word.
  const chainOf = (r: RatingShape | undefined) =>
    r?.history?.length ? r.history : r?.latest != null ? [r.latest] : []
  const ratingHtml = (r: RatingShape | undefined, opts: { sep: string; label: boolean }) => {
    const chain = chainOf(r)
    if (!chain.length) return `<span style="color:${COL.dim};">&mdash;</span>`
    const nums = chain
      .map((n) => `<span style="color:${ratingColor(n)};">${n}</span>`)
      .join(`<span style="color:${COL.dim};">${opts.sep}</span>`)
    const tail = opts.label ? ` <span style="color:${COL.dim};">${esc(RATING_LABEL[String(chain[chain.length - 1])] ?? '')}</span>` : ''
    return `${nums}${tail}`
  }
  const day = (isoStr: string) =>
    new Date(isoStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

  // The week's activity, named. This is the part a Friday read is actually for.
  const d = digest
  const tiles: TileData[] = d
    ? [
        { label: 'New applications', value: num(d.newApplications), sub: 'this week' },
        { label: 'Screened', value: num(d.screened.length), sub: 'this week' },
        { label: 'Moved forward', value: num(d.movements.length), sub: 'candidates, to a later round' },
        {
          label: 'Avg rating',
          value: d.ratings.average != null ? d.ratings.average.toFixed(1) : '—',
          sub: d.ratings.count
            ? `${d.ratings.count} scorecard${d.ratings.count === 1 ? '' : 's'} · 4 = strong yes`
            : 'no scorecards submitted',
        },
      ]
    : [
        { label: 'Invites', value: num(o.invites), sub: deltaSub(o.invites, o.invitesPrev) },
        { label: 'Replies', value: num(o.replies), sub: deltaSub(o.replies, o.repliesPrev) },
        ...(growthPipeline !== null ? [{ label: 'In growth pipeline', value: num(growthPipeline), sub: 'active candidates' }] : []),
        { label: 'Hires this week', value: num(h.thisWeek), sub: deltaSub(h.thisWeek, h.lastWeek) },
      ]

  // Who moved, to what stage, when.
  const movementRows = (d?.movements ?? [])
    .map(
      (m) => `<tr>
        <td style="padding:8px 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COL.text};border-top:1px solid ${COL.border};">${esc(m.name)}</td>
        <td style="padding:8px 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COL.text};border-top:1px solid ${COL.border};">${esc(m.stage)}${m.earlier?.length ? `<div style="font-family:monospace;font-size:10.5px;color:${COL.dim};margin-top:3px;">after ${esc(m.earlier.map((e) => `${e.stage} ${day(e.at)}`).join(' · '))}</div>` : ''}</td>
        <td style="padding:8px 10px;font-family:monospace;font-size:12px;border-top:1px solid ${COL.border};white-space:nowrap;">${ratingHtml(m.rating, { sep: ' &rarr; ', label: true })}</td>
        <td style="padding:8px 10px;font-family:monospace;font-size:12px;color:${COL.muted};border-top:1px solid ${COL.border};white-space:nowrap;">${esc(day(m.at))}</td>
      </tr>`
    )
    .join('')

  const movementSection = d
    ? `<tr><td style="padding:20px 18px 0;">
        <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${COL.dim};margin-bottom:8px;">Moved forward this week</div>
        ${
          movementRows
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.surface};border:1px solid ${COL.border};border-radius:10px;">
                <tr>
                  <th align="left" style="padding:8px 10px;font-family:monospace;font-size:10.5px;text-transform:uppercase;color:${COL.dim};font-weight:normal;">Candidate</th>
                  <th align="left" style="padding:8px 10px;font-family:monospace;font-size:10.5px;text-transform:uppercase;color:${COL.dim};font-weight:normal;">Advanced to</th>
                  <th align="left" style="padding:8px 10px;font-family:monospace;font-size:10.5px;text-transform:uppercase;color:${COL.dim};font-weight:normal;">Rating</th>
                  <th align="left" style="padding:8px 10px;font-family:monospace;font-size:10.5px;text-transform:uppercase;color:${COL.dim};font-weight:normal;">When</th>
                </tr>
                ${movementRows}
              </table>`
            : `<div style="background:${COL.surface};border:1px solid ${COL.border};border-radius:10px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COL.muted};">No one advanced to a later round this week.</div>`
        }
      </td></tr>`
    : ''

  const screenedSection =
    d && d.screened.length
      ? `<tr><td style="padding:16px 18px 0;">
          <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${COL.dim};margin-bottom:8px;">Screened this week</div>
          <div style="background:${COL.surface};border:1px solid ${COL.border};border-radius:10px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${COL.text};">
            ${d.screened.map((s) => `${esc(s.name)}${s.rating?.latest != null ? ` <span style="font-family:monospace;font-size:11.5px;">${ratingHtml(s.rating, { sep: '&rarr;', label: false })}</span>` : ''} <span style="color:${COL.dim};font-family:monospace;font-size:11.5px;">${esc(day(s.at))}</span>`).join(' &nbsp;·&nbsp; ')}
          </div>
        </td></tr>`
      : ''

  // Rating mix, only when scorecards exist — an empty bar chart says nothing.
  const ratingSection =
    d && d.ratings.count
      ? `<tr><td style="padding:16px 18px 0;">
          <div style="font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${COL.dim};margin-bottom:8px;">Scorecards this week</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.surface};border:1px solid ${COL.border};border-radius:10px;">
            <tr><td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${COL.text};">
              ${['4', '3', '2', '1']
                .filter((k) => (d.ratings.distribution[k] ?? 0) > 0)
                .map((k) => `${esc(RATING_LABEL[k])}: <strong>${d.ratings.distribution[k]}</strong>`)
                .join(' &nbsp;·&nbsp; ')}
            </td></tr>
          </table>
        </td></tr>`
      : ''

  // Outbound context, demoted to one line now that the week's pipeline activity leads.
  const contextLine = d
    ? `<tr><td style="padding:16px 18px 0;font-family:monospace;font-size:11.5px;color:${COL.muted};">
        Also this week — outbound: ${num(o.invites)} invites, ${num(o.replies)} replies · hires: ${num(h.thisWeek)}${
        growthPipeline !== null ? ` · ${num(growthPipeline)} active in the Growth pipeline` : ''
      }
      </td></tr>`
    : ''

  const feedback = feedbackPrompt
    ? `<tr><td style="padding:14px 18px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eafaf3;border:1px solid #b7e6d2;border-radius:10px;">
          <tr><td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:${COL.text};">
            <strong>We'd love your feedback on this new summary.</strong> Reply to this email with anything you'd want added or cut, and it comes straight to us.
          </td></tr>
        </table>
      </td></tr>`
    : ''

  const cta = siteUrl
    ? `<tr><td align="center" style="padding:18px 18px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:8px;background:${COL.green};">
            <a href="${esc(siteUrl)}" style="display:inline-block;padding:10px 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">View the full dashboard →</a>
          </td>
        </tr></table>
      </td></tr>`
    : ''

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><style>:root{color-scheme:light;supported-color-schemes:light;}</style></head>
<body style="margin:0;padding:0;background:${COL.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.bg};padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 18px 4px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:600;color:${COL.text};">Coverdash Sales Recruiting - Weekly Summary</div>
          <div style="font-family:monospace;font-size:12px;color:${COL.muted};margin-top:4px;">Week ending ${esc(data.weekEnding)} · for leadership</div>
        </td></tr>

        ${feedback}

        <tr><td style="padding:14px 18px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.surface};border:1px solid ${COL.border};border-left:3px solid ${COL.green};border-radius:10px;">
            <tr><td style="padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${COL.text};">${esc(data.headline)}</td></tr>
          </table>
        </td></tr>

        ${d ? `<tr><td style="padding:18px 18px 0;font-family:monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${COL.dim};">This week on ${esc(d.reqs[0] ?? 'the pipeline')}</td></tr>` : ''}

        <tr><td style="padding:10px 12px 0;">${tileGrid(tiles)}</td></tr>

        ${movementSection}
        ${screenedSection}
        ${ratingSection}
        ${contextLine}

        ${cta}

        <tr><td style="padding:22px 18px;font-family:monospace;font-size:11px;color:${COL.dim};line-height:1.5;">
          Automated weekly summary from the Coverdash recruiting dashboard.
          ${d ? `&ldquo;Moved forward&rdquo; means a completed interview at a stage past the screen, so it reflects rounds that actually happened rather than stage labels. Ratings are Ashby&rsquo;s overall recommendation, where 4 is a strong yes. ` : ''}
          Full trends, rates and pipeline detail live in the dashboard${siteUrl ? ` (<a href="${esc(siteUrl)}" style="color:${COL.muted};">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>)` : ''}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const subject = `Coverdash Sales Recruiting - Week Ending ${data.weekEnding}`
  return { subject, html }
}
