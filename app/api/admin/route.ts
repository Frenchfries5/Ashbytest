import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_COOKIE, adminToken, isAdminRequest, verifyPassword } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Admin session. GET reports whether the caller is signed in; POST signs in with the shared
// password; DELETE signs out. The session cookie gates the inbound-postings write routes.

export async function GET(req: NextRequest) {
  return NextResponse.json(
    { authed: isAdminRequest(req), configured: !!process.env.ADMIN_PASSWORD },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(req: NextRequest) {
  let body: { password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const token = adminToken()
  if (!token) {
    return NextResponse.json({ error: 'Admin access is not configured on the server.' }, { status: 500 })
  }
  if (!verifyPassword(body.password ?? '')) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
