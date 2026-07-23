import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { RECIPIENT_COLUMNS, cleanRecipientPartial, isValidEmail } from '@/lib/email-recipients'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Update (PATCH) or delete (DELETE) a single email recipient by id. Both admin-gated.

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
  const patch = cleanRecipientPartial(body)
  if (typeof patch.email === 'string' && !isValidEmail(patch.email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('email_recipients')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(RECIPIENT_COLUMNS)
    .single()
  if (error) {
    const status = (error as { code?: string }).code === '23505' ? 409 : 502
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ recipient: data }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const { error } = await supabase.from('email_recipients').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 })
  }
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
