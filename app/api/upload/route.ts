import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { password, label, rows } = body

  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!label || !rows || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'Missing label or rows' }, { status: 400 })
  }

  const { error } = await supabase.from('sourcing_weeks').insert({ label, rows })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
