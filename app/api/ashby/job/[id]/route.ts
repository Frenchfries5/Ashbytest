import { NextResponse } from 'next/server'
import {
  ashbyConfigured,
  listJobCandidates,
  stageRank,
  isRelevantStage,
  STALLED_DAYS,
  type Candidate,
} from '@/lib/ashby'

export const dynamic = 'force-dynamic'

// Fast path: job meta + active candidates grouped by stage. Deliberately cheap (no full-funnel
// pull, no per-candidate history) so the drawer opens quickly. The heavier source/rejection/
// time-in-stage analytics live in ./analysis and load progressively.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!ashbyConfigured()) {
    return NextResponse.json(
      { configured: false, job: null, stages: [], total: 0, relevant: 0 },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    // Job metadata is already in hand on the client (passed as the drawer's fallback from
    // the loaded overview), so we skip re-fetching it here to keep this path fast.
    const candidates = await listJobCandidates(id)

    // Group active candidates by current stage.
    const byStage = new Map<string, Candidate[]>()
    for (const c of candidates) {
      const key = c.stage?.title ?? 'Unassigned'
      const arr = byStage.get(key) ?? []
      arr.push(c)
      byStage.set(key, arr)
    }

    const stages = Array.from(byStage.entries())
      .map(([name, list]) => ({
        stage: name,
        type: list[0]?.stage?.type ?? null,
        order: list[0]?.stage?.order ?? null,
        relevant: isRelevantStage(list[0]?.stage ?? null),
        count: list.length,
        // Longest-idle first — surfaces candidates who've gone without movement.
        candidates: list.sort((a, b) => (b.daysSinceActivity ?? -1) - (a.daysSinceActivity ?? -1)),
      }))
      // Furthest-along stage first (Offer/Hired at the top).
      .sort((a, b) => {
        if (a.order !== null && b.order !== null) return b.order - a.order
        return stageRank(b.stage) - stageRank(a.stage)
      })

    const total = candidates.length
    const relevant = candidates.filter((c) => isRelevantStage(c.stage)).length
    const oldest = candidates.reduce<number | null>(
      (mx, c) => (c.daysInPipeline !== null && (mx === null || c.daysInPipeline > mx) ? c.daysInPipeline : mx),
      null
    )

    return NextResponse.json(
      {
        configured: true,
        job: null, // client uses the fallback role meta from the overview
        stages,
        total,
        relevant,
        oldestActiveDays: oldest,
        stalled: oldest !== null && oldest > STALLED_DAYS,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err instanceof Error ? err.message : err), stages: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
