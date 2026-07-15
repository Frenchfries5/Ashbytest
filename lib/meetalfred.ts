// Server-only MeetAlfred client. Do NOT import this from a client component.
//
// AUTH: MeetAlfred authenticates via a `webhook_key` QUERY PARAM — not a header. The key is
// generated in MeetAlfred account settings ("API Key" / "webhook key") and read from
// MEETALFRED_API_KEY. Because the secret rides in the query string, every call must stay
// server-side and we never log the full URL (see `redact`).
//
// BASE: https://meetalfred.com/api/integrations/webhook/<action>?webhook_key=...
// Read endpoints are GET and paginate with `page` (0-based) + `per_page`. List endpoints
// return their rows under an `actions` array (campaigns may differ — the probe confirms).
//
// Response shapes are intentionally loose (Record<string, unknown>): the live doc examples
// were collapsed, so we discover exact field names via /api/meetalfred/probe rather than
// guessing a typed contract now.

const BASE =
  process.env.MEETALFRED_BASE_URL?.replace(/\/$/, '') ||
  'https://meetalfred.com/api/integrations/webhook'

export function meetalfredConfigured(): boolean {
  return !!process.env.MEETALFRED_API_KEY
}

export class MeetAlfredError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'MeetAlfredError'
    this.status = status
  }
}

// Never surface the webhook_key in errors or logs.
function redact(url: string): string {
  return url.replace(/(webhook_key=)[^&]+/, '$1***')
}

const MAX_RETRIES = 5
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms))

// Global rate gate: MeetAlfred throttles hard, so serialize every outgoing request with a
// minimum spacing between starts (across all callers/concurrency). This is the real limiter;
// the 429 backoff below is just a safety net for bursts the gate doesn't fully absorb.
const MIN_REQUEST_INTERVAL_MS = 400
let gateChain: Promise<void> = Promise.resolve()
function rateGate(): Promise<void> {
  const wait = gateChain.then(() => sleep(MIN_REQUEST_INTERVAL_MS))
  // Next caller waits for this one's spacing window; swallow errors so the chain never breaks.
  gateChain = wait.catch(() => {})
  return gateChain
}

// Run async tasks with a max concurrency, preserving input order in the results. Used to keep
// the weekly fan-out from tripping MeetAlfred's rate limiter.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

type Params = Record<string, string | number | boolean | undefined>

async function maRequest<T>(
  method: 'GET' | 'POST',
  action: string,
  params: Params = {},
  body?: unknown,
  // Override the webhook_key — used to query a specific team member's data with THEIR key
  // (see getTeamMembers). Server-side only; never pass a key that reached the browser.
  webhookKey?: string
): Promise<T> {
  const key = webhookKey ?? process.env.MEETALFRED_API_KEY
  if (!key) throw new MeetAlfredError(0, 'MEETALFRED_API_KEY is not set')

  const url = new URL(`${BASE}/${action}`)
  url.searchParams.set('webhook_key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  // MeetAlfred throttles aggressively (429). Retry with backoff, honoring Retry-After.
  let text = ''
  let status = 0
  for (let attempt = 0; ; attempt++) {
    await rateGate()
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
    status = res.status
    text = await res.text()
    if (status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(8000, 500 * 2 ** attempt)
      await sleep(waitMs)
      continue
    }
    break
  }

  if (status < 200 || status >= 300) {
    throw new MeetAlfredError(
      status,
      `${method} ${redact(url.toString())} -> ${status}: ${text.slice(0, 300)}`
    )
  }
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new MeetAlfredError(
      status,
      `Non-JSON response from ${redact(url.toString())}: ${text.slice(0, 200)}`
    )
  }
}

const maGet = <T>(action: string, params?: Params, webhookKey?: string) =>
  maRequest<T>('GET', action, params, undefined, webhookKey)

// Loose list envelope — most read endpoints wrap rows in `actions`.
export interface MaListResponse<T = Record<string, unknown>> {
  actions?: T[]
  [key: string]: unknown
}

// ── Read endpoints ───────────────────────────────────────────────────────────────

export type CampaignType = 'active' | 'draft' | 'archived' | 'all'

export function getCampaigns(type: CampaignType = 'active', webhookKey?: string) {
  return maGet<MaListResponse>('campaigns', { type }, webhookKey)
}

export function getNewLeads(opts: { campaign?: number; page?: number; perPage?: number } = {}) {
  return maGet<MaListResponse>('new-leads', {
    campaign: opts.campaign,
    page: opts.page,
    per_page: opts.perPage,
  })
}

export function getNewConnections(
  opts: { page?: number; perPage?: number; returnOnlySynced?: boolean } = {}
) {
  return maGet<MaListResponse>('new-connections', {
    return_only_synced: opts.returnOnlySynced,
    page: opts.page,
    per_page: opts.perPage,
  })
}

export function getNewReplies(opts: { page?: number; perPage?: number } = {}) {
  return maGet<MaListResponse>('new-reply-detected', {
    page: opts.page,
    per_page: opts.perPage,
  })
}

// A team member. `webhook_key` is a SECRET — keep it server-side; never return it to a client
// or log it. Only the team owner's key can list members.
export interface MaTeamMember {
  id: number
  name: string
  email: string
  webhook_key: string
  timezone?: unknown
}

export async function getTeamMembers(): Promise<MaTeamMember[]> {
  const data = await maGet<MaListResponse<MaTeamMember>>('get_team_members')
  if (Array.isArray(data)) return data as MaTeamMember[]
  if (Array.isArray(data.actions)) return data.actions
  const arr = Object.values(data).find(Array.isArray)
  return (arr as MaTeamMember[] | undefined) ?? []
}

// A row from get-last-actions. `created_at` is the canonical event time (invite sent, message
// sent, connection accepted, reply received) and is what we bucket by week.
export interface MaAction {
  id: number | string
  created_at?: string
  desc?: string
  [key: string]: unknown
}

export type LastActionType =
  | 'invites'
  | 'already_connected'
  | 'already_invited'
  | 'accepted'
  | 'messages'
  | 'replies'
  | 'emails'
  | 'email_replies'
  | 'twitter'
  | 'twitter_replies'
  | 'all_replies'
  | 'greetings'

export function getLastActions(
  action: LastActionType,
  opts: { page?: number; perPage?: number; webhookKey?: string } = {}
) {
  return maGet<MaListResponse<MaAction>>(
    'get-last-actions',
    { action, page: opts.page, per_page: opts.perPage },
    opts.webhookKey
  )
}

// Page backwards through get-last-actions (newest first) for one member's key, stopping once
// events predate `sinceMs` or the page cap is hit. Returns the rows plus a `capped` flag so
// callers can surface truncation instead of silently under-counting.
export async function getLastActionsSince(
  action: LastActionType,
  sinceMs: number,
  opts: { webhookKey?: string; perPage?: number; maxPages?: number } = {}
): Promise<{ actions: MaAction[]; capped: boolean }> {
  const perPage = opts.perPage ?? 100
  const maxPages = opts.maxPages ?? 40
  const out: MaAction[] = []
  for (let page = 0; page < maxPages; page++) {
    const data = await getLastActions(action, { page, perPage, webhookKey: opts.webhookKey })
    const rows = data.actions ?? []
    out.push(...rows)
    if (rows.length < perPage) return { actions: out, capped: false } // last page reached
    const oldest = parseActionDate(rows[rows.length - 1]?.created_at)
    if (oldest !== null && oldest < sinceMs) return { actions: out, capped: false } // went past window
  }
  return { actions: out, capped: true } // hit the page cap before exhausting history
}

// MeetAlfred timestamps come as "2026-07-15 13:57:05+00:00" (space, not 'T') or ISO "…Z".
// Normalize the space form so Date.parse is reliable across engines.
export function parseActionDate(s: string | undefined): number | null {
  if (!s) return null
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T'))
  return Number.isNaN(t) ? null : t
}

// ── Write endpoint (NOT used by the probe — it mutates campaigns) ─────────────────
// Left here for later; adds a lead to a campaign. POST, unlike the reads.
export function addLeadToCampaign(input: {
  campaign: number
  linkedin_profile_url: string
  email?: string
  [csvField: string]: string | number | undefined
}) {
  return maRequest<unknown>('POST', 'add_lead_to_campaign', {}, input)
}
