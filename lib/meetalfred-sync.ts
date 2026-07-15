// MeetAlfred → Supabase incremental sync (server-only).
//
// Pulls the 4 tracked action streams (invites/accepted/messages/replies) for every team
// member and upserts them into `meetalfred_events`. Two modes:
//   - 'backfill'    : page every stream back to the beginning (sinceMs = 0). Run once, locally
//                     (it's minutes of rate-limited paging — too long for a serverless request).
//   - 'incremental' : page back only to the watermark (last_meetalfred_query) minus an overlap
//                     buffer, so we re-check a small window and never miss late/mid-sync events.
//
// The upsert key (member_id, action_type, event_id) makes overlapping windows idempotent.
// The watermark is advanced to the moment the sync STARTED (not the newest event seen), and
// only after every stream upserts successfully — so a mid-run failure is safe to retry.

import { supabase } from './supabase'
import {
  getTeamMembers,
  getLastActionsSince,
  getCampaigns,
  parseActionDate,
  type LastActionType,
  type MaListResponse,
} from './meetalfred'

const STREAMS: LastActionType[] = ['invites', 'accepted', 'messages', 'replies']

// Re-scan this far behind the watermark on incremental syncs, to absorb clock skew and
// events that land slightly out of order. Idempotent upserts make the overlap free.
const OVERLAP_MS = 6 * 60 * 60 * 1000 // 6 hours

export type SyncMode = 'backfill' | 'incremental'

export interface SyncSummary {
  mode: SyncMode
  members: number
  perStream: Record<string, number>
  upserted: number
  capped: boolean
  watermarkBefore: string | null
  watermarkAfter: string
  elapsedMs: number
}

interface EventRow {
  member_id: number
  member_name: string
  action_type: string
  event_id: string
  created_at: string
  raw: unknown
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function upsertEvents(rows: EventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  // De-dupe within the batch: upsert can't touch the same PK twice in one statement.
  const seen = new Map<string, EventRow>()
  for (const r of rows) seen.set(`${r.member_id}|${r.action_type}|${r.event_id}`, r)
  const deduped = [...seen.values()]

  let n = 0
  for (const c of chunk(deduped, 500)) {
    const { error } = await supabase
      .from('meetalfred_events')
      .upsert(c, { onConflict: 'member_id,action_type,event_id' })
    if (error) throw new Error(`meetalfred_events upsert failed: ${error.message}`)
    n += c.length
  }
  return n
}

async function readWatermark(): Promise<string | null> {
  const { data, error } = await supabase
    .from('site_state')
    .select('last_meetalfred_query')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`site_state read failed: ${error.message}`)
  return data?.last_meetalfred_query ?? null
}

export async function syncMeetAlfredEvents(mode: SyncMode): Promise<SyncSummary> {
  const startedAtMs = Date.now()
  const watermarkBefore = await readWatermark()
  const watermarkBeforeMs = watermarkBefore ? parseActionDate(watermarkBefore) : null

  // Backfill (or a never-synced DB) pulls everything; incremental pulls back to the buffered
  // watermark. maxPages is generous for backfill so full history isn't silently truncated.
  const sinceMs =
    mode === 'backfill' || watermarkBeforeMs === null
      ? 0
      : Math.max(0, watermarkBeforeMs - OVERLAP_MS)
  const maxPages = mode === 'backfill' ? 1000 : 60

  const members = await getTeamMembers()
  const perStream: Record<string, number> = {}
  let upserted = 0
  let capped = false

  for (const m of members) {
    // Best-effort: capture the member's current active-campaign count. Skips silently if the
    // meetalfred_members table doesn't exist or the campaigns call fails — never fails the sync.
    try {
      const camp: MaListResponse = await getCampaigns('active', m.webhook_key)
      const list = Array.isArray(camp)
        ? camp
        : (Object.values(camp).find(Array.isArray) as unknown[] | undefined) ?? []
      await supabase
        .from('meetalfred_members')
        .upsert(
          { member_id: m.id, name: m.name, campaigns_active: list.length, updated_at: new Date().toISOString() },
          { onConflict: 'member_id' }
        )
    } catch {
      /* members table is optional */
    }

    for (const action of STREAMS) {
      const res = await getLastActionsSince(action, sinceMs, {
        webhookKey: m.webhook_key,
        maxPages,
      })
      if (res.capped) capped = true

      const rows: EventRow[] = []
      for (const a of res.actions) {
        const t = parseActionDate(a.created_at)
        if (t === null) continue
        if (sinceMs && t < sinceMs) continue
        rows.push({
          member_id: m.id,
          member_name: m.name,
          action_type: action,
          event_id: String(a.id),
          created_at: new Date(t).toISOString(),
          raw: a,
        })
      }
      // Persist each stream as we go, so a later failure doesn't lose earlier progress.
      upserted += await upsertEvents(rows)
      perStream[action] = (perStream[action] ?? 0) + rows.length
    }
  }

  // Only advance the watermark after every stream succeeded — to the sync's start time.
  const watermarkAfter = new Date(startedAtMs).toISOString()
  const { error } = await supabase
    .from('site_state')
    .update({ last_meetalfred_query: watermarkAfter })
    .eq('id', 1)
  if (error) throw new Error(`site_state watermark update failed: ${error.message}`)

  return {
    mode,
    members: members.length,
    perStream,
    upserted,
    capped,
    watermarkBefore,
    watermarkAfter,
    elapsedMs: Date.now() - startedAtMs,
  }
}
