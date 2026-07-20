// Shared-password admin gate. Guards the inbound-postings write routes (POST/PATCH/DELETE)
// so hiding the buttons in the UI isn't the only thing standing between the public and a
// mutation — anyone can curl the API otherwise.
//
// The cookie stores a hash of ADMIN_PASSWORD, never the raw password, so the secret never
// lives in the browser and rotating the env var invalidates every outstanding session.

import { createHash, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export const ADMIN_COOKIE = 'cd_admin'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

// Constant-time string compare. Both inputs are hashed to a fixed length before comparing,
// so a length mismatch (which timingSafeEqual rejects) can't happen and lengths don't leak.
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)))
}

// The session token: a namespaced hash of the password. Returns null when unconfigured.
export function adminToken(): string | null {
  const pw = process.env.ADMIN_PASSWORD
  if (!pw) return null
  return sha256(`cd-admin:${pw}`)
}

export function verifyPassword(input: string): boolean {
  const pw = process.env.ADMIN_PASSWORD
  if (!pw || !input) return false
  return safeEqual(input, pw)
}

export function isAdminRequest(req: NextRequest): boolean {
  const token = adminToken()
  if (!token) return false
  const cookie = req.cookies.get(ADMIN_COOKIE)?.value
  if (!cookie) return false
  return safeEqual(cookie, token)
}
