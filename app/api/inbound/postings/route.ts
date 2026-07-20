import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { INBOUND_COLUMNS, cleanPosting } from '@/lib/inbound'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Inbound job postings, stored in Supabase (replaces the Google Sheet). GET lists all;
// POST creates one. Writes go through this server route so the service-role key never
// reaches the browser.

export async function GET() {
  const { data, error } = await supabase
    .from('inbound_postings')
    .select(INBOUND_COLUMNS)
    .order('date_posted', { ascending: false, nullsFirst: false })
  if (error) {
    return NextResponse.json({ error: error.message, postings: [] }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ postings: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
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
  const row = cleanPosting(body)
  // Posting date is required — dateless rows are filtered out of the list & charts.
  if (!row.date_posted) {
    return NextResponse.json({ error: 'date_posted is required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('inbound_postings')
    .insert(row)
    .select(INBOUND_COLUMNS)
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json({ posting: data }, { headers: { 'Cache-Control': 'no-store' } })
}
