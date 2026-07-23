// Shared helpers for the email_recipients routes (mirrors lib/inbound.ts).

export const RECIPIENT_COLUMNS = 'id, email, name, active'

// Full clean row — used by CREATE (POST).
export function cleanRecipient(body: Record<string, unknown>) {
  return {
    email: cleanEmail(body.email),
    name: body.name ? String(body.name).trim() || null : null,
    active: body.active === undefined ? true : Boolean(body.active),
  }
}

// Partial clean — used by UPDATE (PATCH): only includes fields actually present in the body,
// so a partial update never nulls out columns the caller didn't send.
export function cleanRecipientPartial(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  if (Object.prototype.hasOwnProperty.call(body, 'email')) out.email = cleanEmail(body.email)
  if (Object.prototype.hasOwnProperty.call(body, 'name')) out.name = body.name ? String(body.name).trim() || null : null
  if (Object.prototype.hasOwnProperty.call(body, 'active')) out.active = Boolean(body.active)
  return out
}

function cleanEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}
