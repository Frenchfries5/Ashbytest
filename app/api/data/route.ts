import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('sourcing_weeks')
    .select('id, label, rows, inserted_at')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const MONTHS: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  }

  // Parse the start date from label "Mon DD – Mon DD, YYYY"
  function labelToDate(label: string): Date {
    const m = label.match(/^(\w{3})\s+(\d+)/)
    if (!m) return new Date(0)
    const yearMatch = label.match(/(\d{4})/)
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear()
    return new Date(year, MONTHS[m[1]] ?? 0, parseInt(m[2]))
  }

  const weeks = (data ?? [])
    .map((row: { id: number; label: string; rows: unknown }) => ({
      id: row.id,
      label: row.label,
      rows: row.rows,
    }))
    .sort((a, b) => labelToDate(a.label).getTime() - labelToDate(b.label).getTime())

  return NextResponse.json({ weeks })
}
