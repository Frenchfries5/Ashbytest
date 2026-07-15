import { NextResponse } from 'next/server'
import {
  meetalfredConfigured,
  getCampaigns,
  getNewLeads,
  getNewConnections,
  getNewReplies,
  type MaListResponse,
} from '@/lib/meetalfred'

export const dynamic = 'force-dynamic'

// EXPERIMENTAL data probe: hits MeetAlfred's read-only webhook endpoints and reports, for each,
// whether the call succeeded, how many rows came back, and the shape (top-level + first-row
// field names) plus one sample row. This proves the connection works and reveals the real
// JSON contract before any UI is built. The write endpoint (add_lead_to_campaign) is
// deliberately NOT exercised here.

interface ProbeResult {
  ok: boolean
  count?: number
  topLevelKeys?: string[]
  sampleKeys?: string[]
  sample?: unknown
  error?: string
}

// Extract the row array whether the endpoint wraps it in `actions`, some other key, or
// returns a bare array.
function extractRows(data: MaListResponse | unknown[]): unknown[] | undefined {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.actions)) return obj.actions
    // Fall back to the first array-valued property (e.g. `campaigns`).
    const arr = Object.values(obj).find((v) => Array.isArray(v))
    if (Array.isArray(arr)) return arr
  }
  return undefined
}

async function probe(fn: () => Promise<MaListResponse | unknown[]>): Promise<ProbeResult> {
  try {
    const data = await fn()
    const rows = extractRows(data)
    const sample = rows?.[0] ?? data
    return {
      ok: true,
      count: rows?.length,
      topLevelKeys:
        data && typeof data === 'object' && !Array.isArray(data)
          ? Object.keys(data as Record<string, unknown>)
          : undefined,
      sampleKeys:
        sample && typeof sample === 'object' ? Object.keys(sample as Record<string, unknown>) : undefined,
      sample,
    }
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) }
  }
}

export async function GET() {
  if (!meetalfredConfigured()) {
    return NextResponse.json(
      { configured: false, hint: 'Set MEETALFRED_API_KEY in .env.local, then reload.' },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const [campaigns, leads, connections, replies] = await Promise.all([
    probe(() => getCampaigns('all')),
    probe(() => getNewLeads({ page: 0, perPage: 3 })),
    probe(() => getNewConnections({ page: 0, perPage: 3, returnOnlySynced: true })),
    probe(() => getNewReplies({ page: 0, perPage: 3 })),
  ])

  return NextResponse.json(
    { configured: true, endpoints: { campaigns, leads, connections, replies } },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
