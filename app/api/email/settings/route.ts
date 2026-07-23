import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// Weekly-email settings, stored on the single-row site_state table. Admin-only.
// Currently just the "show feedback callout" toggle.

const NOSTORE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { data, error } = await supabase
    .from('site_state')
    .select('email_feedback_prompt')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502, headers: NOSTORE })
  }
  return NextResponse.json({ feedbackPrompt: data?.email_feedback_prompt ?? true }, { headers: NOSTORE })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: { feedbackPrompt?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const value = !!body.feedbackPrompt
  const { error } = await supabase.from('site_state').update({ email_feedback_prompt: value }).eq('id', 1)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502, headers: NOSTORE })
  }
  return NextResponse.json({ ok: true, feedbackPrompt: value }, { headers: NOSTORE })
}
