import { NextResponse } from 'next/server'

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQFTLez7EBF0TaVAWnQwZbqe5WZWdhCwJrySd2KckXblSyOKAdO-aH03O-QL6ag5cOOX1sWjCGtL5zg/pub?gid=649014410&single=true&output=csv'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch(SHEET_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to fetch Ashby sheet')
    const csv = await res.text()
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
