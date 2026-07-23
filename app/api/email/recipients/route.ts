import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { RECIPIENT_COLUMNS, cleanRecipient, isValidEmail } from '@/lib/email-recipients'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Stakeholder recipients for the weekly email. Unlike inbound postings (public GET), every verb
// here is admin-gated — a recipient email list is more sensitive than public posting stats.

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabase
    .from('email_recipients')
    .select(RECIPIENT_COLUMNS)
    .order('email', { ascending: true })
  if (error) {
    return NextResponse.json({ error: error.message, recipients: [] }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ recipients: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const row = cleanRecipient(body)
  if (!isValidEmail(row.email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('email_recipients')
    .insert(row)
    .select(RECIPIENT_COLUMNS)
    .single()
  if (error) {
    // 23505 = unique violation (duplicate email)
    const status = (error as { code?: string }).code === '23505' ? 409 : 502
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ recipient: data }, { headers: { 'Cache-Control': 'no-store' } })
}
