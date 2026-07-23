// Plain HTML email builder for the weekly Executive Summary. Table-based layout with inline
// styles and static hex colors — email clients don't support flex/grid or CSS variables.
// Mirrors the Executive Summary tab's blocks: the narrative sentence + the same six hero numbers
// in the same order (delta vs last week). The trend chart can't come along (SVG is stripped by
// email clients) — a link to the dashboard covers that. Fed by lib/executive-summary.ts, so the
// numbers stay in lockstep with the tab.

import type { OutboundScorecard, HiresScorecard } from '@/lib/executive-summary'

export interface WeeklySummaryData {
  headline: string
  weekEnding: string // human label, e.g. "Jul 18, 2026"
  siteUrl: string | null
  outbound: OutboundScorecard
  growthPipeline: number | null
  // Recruiter screens + moved forward: Megan, last completed week (matches the tab's chips).
  screens: { value: number; prev: number | null }
  movedForward: { value: number; prev: number | null }
  hires: HiresScorecard
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
  const { outbound: o, hires: h, growthPipeline, screens, movedForward, siteUrl } = data

  // Same blocks as the Executive Summary hero strip, same order:
  // Invites, Replies, In growth pipeline / Recruiter screens, Moved forward, Hires this week.
  const tiles: TileData[] = [
    { label: 'Invites', value: num(o.invites), sub: deltaSub(o.invites, o.invitesPrev) },
    { label: 'Replies', value: num(o.replies), sub: deltaSub(o.replies, o.repliesPrev) },
    ...(growthPipeline !== null ? [{ label: 'In growth pipeline', value: num(growthPipeline), sub: 'active candidates, Growth role' }] : []),
    { label: 'Recruiter screens', value: num(screens.value), sub: deltaSub(screens.value, screens.prev) },
    { label: 'Moved forward', value: num(movedForward.value), sub: deltaSub(movedForward.value, movedForward.prev) },
    { label: 'Hires this week', value: num(h.thisWeek), sub: deltaSub(h.thisWeek, h.lastWeek) },
  ]

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
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:600;color:${COL.text};">Coverdash recruiting — weekly summary</div>
          <div style="font-family:monospace;font-size:12px;color:${COL.muted};margin-top:4px;">Week ending ${esc(data.weekEnding)} · for leadership</div>
        </td></tr>

        <tr><td style="padding:14px 18px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.surface};border:1px solid ${COL.border};border-left:3px solid ${COL.green};border-radius:10px;">
            <tr><td style="padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:${COL.text};">${esc(data.headline)}</td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:14px 12px 0;">${tileGrid(tiles)}</td></tr>

        ${cta}

        <tr><td style="padding:22px 18px;font-family:monospace;font-size:11px;color:${COL.dim};line-height:1.5;">
          Automated weekly summary from the Coverdash recruiting dashboard. Recruiter screens and moved-forward are Megan's, last completed week; the full trend, rates, and pipeline detail live in the dashboard${siteUrl ? ` (<a href="${esc(siteUrl)}" style="color:${COL.muted};">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>)` : ''}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const subject = `Coverdash recruiting — week ending ${data.weekEnding}`
  return { subject, html }
}
