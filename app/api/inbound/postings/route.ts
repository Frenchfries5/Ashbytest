import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { INBOUND_COLUMNS, cleanPosting } from '@/lib/inbound'

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
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('inbound_postings')
    .insert(cleanPosting(body))
    .select(INBOUND_COLUMNS)
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json({ posting: data }, { headers: { 'Cache-Control': 'no-store' } })
}
