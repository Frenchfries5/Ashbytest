// Plain HTML email builder for the weekly Executive Summary. Table-based layout with inline
// styles and static hex colors — email clients don't support flex/grid or CSS variables.
// Lean version mirroring the Executive Summary tab: a narrative sentence + the same five hero
// numbers (delta vs last week only). No rates, rolling averages, or trend chart (SVG is stripped
// by email clients). Fed by lib/executive-summary.ts, so numbers stay in lockstep with the tab.

import type { OutboundScorecard, InboundScorecard, HiresScorecard } from '@/lib/executive-summary'

export interface WeeklySummaryData {
  headline: string
  weekEnding: string // human label, e.g. "Jul 18, 2026"
  outbound: OutboundScorecard
  inbound: InboundScorecard | null
  recruiterScreens: { thisWeek: number; lastWeek: number | null } | null
  hires: HiresScorecard
  growthPipeline: number | null
}

// dashboard-echoing palette (static hex — no CSS vars in email)
const COL = {
  bg: '#0d1117', surface: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e', dim: '#484f58',
  green: '#3adea0',
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
  const { outbound: o, inbound: i, recruiterScreens: rs, hires: h, growthPipeline } = data

  // The hero numbers — same as the Executive Summary tab.
  const tiles: TileData[] = [
    { label: 'Invites', value: num(o.invites), sub: deltaSub(o.invites, o.invitesPrev) },
    { label: 'Replies', value: num(o.replies), sub: deltaSub(o.replies, o.repliesPrev) },
    ...(i ? [{ label: 'Relevant inbound', value: num(i.relevant), sub: deltaSub(i.relevant, i.relevantPrev) }] : []),
    ...(rs ? [{ label: 'Recruiter screens', value: num(rs.thisWeek), sub: deltaSub(rs.thisWeek, rs.lastWeek) }] : []),
    { label: 'Hires this week', value: num(h.thisWeek), sub: deltaSub(h.thisWeek, h.lastWeek) },
    ...(growthPipeline !== null ? [{ label: 'Growth pipeline', value: num(growthPipeline), sub: 'active candidates, Growth role' }] : []),
  ]

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
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

        <tr><td style="padding:22px 18px;font-family:monospace;font-size:11px;color:${COL.dim};line-height:1.5;">
          Automated weekly summary from the Coverdash recruiting dashboard. Full detail — rates, trends, and pipeline breakdowns — lives in the dashboard.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

  const subject = `Coverdash recruiting — week ending ${data.weekEnding}`
  return { subject, html }
}
