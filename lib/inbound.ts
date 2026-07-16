// Shared helpers for the inbound_postings routes.

export const INBOUND_COLUMNS =
  'id, poster, date_posted, title, views, applicants, relevant, duration_days, date_removed, role, platform, paid, note'

const NUM_FIELDS = ['views', 'applicants', 'relevant', 'duration_days'] as const
const DATE_FIELDS = ['date_posted', 'date_removed'] as const
const TEXT_FIELDS = ['poster', 'title', 'role', 'platform', 'note'] as const

function coerce(field: string, v: unknown) {
  if ((NUM_FIELDS as readonly string[]).includes(field)) return v === '' || v === null || v === undefined ? null : Number(v)
  if ((DATE_FIELDS as readonly string[]).includes(field)) return v ? String(v) : null
  if (field === 'paid') return Boolean(v)
  return v ? String(v) : null
}

// Full clean row (all columns) — used by CREATE (POST), where every field should be set.
export function cleanPosting(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const f of [...TEXT_FIELDS, ...NUM_FIELDS, ...DATE_FIELDS, 'paid']) out[f] = coerce(f, body[f])
  return out
}

// Partial clean — used by UPDATE (PATCH): only includes fields actually present in the body,
// so a partial update never nulls out columns the caller didn't send.
export function cleanPostingPartial(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const f of [...TEXT_FIELDS, ...NUM_FIELDS, ...DATE_FIELDS, 'paid']) {
    if (Object.prototype.hasOwnProperty.call(body, f)) out[f] = coerce(f, body[f])
  }
  return out
}
