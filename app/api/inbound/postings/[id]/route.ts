import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { INBOUND_COLUMNS, cleanPostingPartial } from '@/lib/inbound'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Update (PATCH) or delete (DELETE) a single inbound posting by id.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('inbound_postings')
    .update({ ...cleanPostingPartial(body), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(INBOUND_COLUMNS)
    .single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json({ posting: data }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const { error } = await supabase.from('inbound_postings').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
