import { NextResponse } from 'next/server'
import {
  ashbyConfigured,
  listOpenJobs,
  listClosedJobs,
  listActiveApplications,
  listAllJobApplications,
  isRelevantStage,
  isRelevantApplication,
  orderStageNames,
  mapLimit,
  STALLED_DAYS,
  type Stage,
} from '@/lib/ashby'

export const dynamic = 'force-dynamic'
// The closed-roles view fans out full-funnel pulls across every closed job (thousands of
// archived apps), so it can take ~30s. Raise the ceiling (Vercel Hobby caps at 60s).
export const maxDuration = 60

interface RoleStages {
  [stageName: string]: number
}

interface Role {
  id: string
  title: string
  status: string | null
  department: string | null
  location: string | null
  employmentType: string | null
  openedAt: string | null
  daysOpen: number | null
  openings: number | null
  recruiter: string | null
  stages: RoleStages
  total: number
  relevant: number
  offerCount: number
  oldestActiveDays: number | null
  idleDays: number | null       // longest any active candidate has gone without movement
  newThisWeek: number           // applications created in the last 7 days
  topSource: string | null      // most common source among active candidates
  owners: { name: string; count: number }[] // recruiter/owner load
  stalled: boolean
}

const DAY = 1000 * 60 * 60 * 24

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / DAY))
}

// Closed/Archived roles: post-hoc outcome summary per role (total applicants, hired, archived,
// top source, top rejection reason). Full source/rejection detail is in the drawer's analysis.
async function closedPipeline() {
  const jobs = await listClosedJobs()
  const perJob = await mapLimit(jobs, 4, async (j) => ({ job: j, apps: await listAllJobApplications(j.id) }))

  const roles = perJob.map(({ job, apps }) => {
    const hired = apps.filter((a) => a.status === 'Hired').length
    const archived = apps.filter((a) => a.status === 'Archived').length
    const relevant = apps.filter((a) => isRelevantApplication(a)).length

    const srcCounts = new Map<string, number>()
    for (const a of apps) if (a.source) srcCounts.set(a.source, (srcCounts.get(a.source) ?? 0) + 1)
    let topSource: string | null = null, topN = 0
    for (const [s, n] of srcCounts) if (n > topN) { topN = n; topSource = s }

    const reasonCounts = new Map<string, number>()
    for (const a of apps) if (a.status === 'Archived') { const r = a.archiveReason ?? 'No reason given'; reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1) }
    let topArchiveReason: string | null = null, topR = 0
    for (const [r, n] of reasonCounts) if (n > topR) { topR = n; topArchiveReason = r }

    return {
      id: job.id,
      title: job.title,
      status: job.status,
      department: job.department,
      location: job.location,
      employmentType: job.employmentType,
      openedAt: job.openedAt,
      daysOpen: daysSince(job.openedAt),
      openings: job.openings,
      recruiter: job.recruiter,
      total: apps.length,
      hired,
      archived,
      relevant,
      topSource,
      topArchiveReason,
      // Fields the shared Role/drawer shape expects, N/A for closed roles:
      stages: {} as RoleStages,
      offerCount: 0,
      oldestActiveDays: null,
      idleDays: null,
      newThisWeek: 0,
      owners: [] as { name: string; count: number }[],
      stalled: false,
    }
  }).sort((a, b) => b.total - a.total)

  const totals = {
    closedRoles: roles.length,
    totalApplicants: roles.reduce((s, r) => s + r.total, 0),
    hired: roles.reduce((s, r) => s + r.hired, 0),
    archived: roles.reduce((s, r) => s + r.archived, 0),
    relevant: roles.reduce((s, r) => s + r.relevant, 0),
  }

  return NextResponse.json(
    { configured: true, view: 'closed', generatedAt: new Date().toISOString(), stageOrder: [], totals, roles },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function GET(req: Request) {
  if (!ashbyConfigured()) {
    return NextResponse.json(
      { configured: false, generatedAt: new Date().toISOString(), stageOrder: [], totals: null, roles: [] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (new URL(req.url).searchParams.get('status') === 'closed') {
    try {
      return await closedPipeline()
    } catch (err) {
      return NextResponse.json(
        { configured: true, view: 'closed', error: String(err instanceof Error ? err.message : err), roles: [] },
        { status: 502, headers: { 'Cache-Control': 'no-store' } }
      )
    }
  }

  try {
    const [jobs, apps] = await Promise.all([listOpenJobs(), listActiveApplications()])

    // jobId -> role accumulator
    const roleMap = new Map<string, Role>()
    // Side accumulators keyed by roleId (kept off the Role until finalized).
    const sourceCounts = new Map<string, Map<string, number>>()
    const ownerCounts = new Map<string, Map<string, number>>()
    for (const j of jobs) {
      roleMap.set(j.id, {
        id: j.id,
        title: j.title,
        status: j.status,
        department: j.department,
        location: j.location,
        employmentType: j.employmentType,
        openedAt: j.openedAt,
        daysOpen: daysSince(j.openedAt),
        openings: j.openings,
        recruiter: j.recruiter,
        stages: {},
        total: 0,
        relevant: 0,
        offerCount: 0,
        oldestActiveDays: null,
        idleDays: null,
        newThisWeek: 0,
        topSource: null,
        owners: [],
        stalled: false,
      })
      sourceCounts.set(j.id, new Map())
      ownerCounts.set(j.id, new Map())
    }

    const stageSeen = new Set<string>()

    for (const a of apps) {
      if (!a.jobId) continue
      const role = roleMap.get(a.jobId)
      if (!role) continue // application on a job that isn't open — skip

      const stage: Stage | null = a.stage
      const stageName = stage?.title ?? 'Unassigned'
      stageSeen.add(stageName)

      role.stages[stageName] = (role.stages[stageName] ?? 0) + 1
      role.total += 1
      if (isRelevantStage(stage)) role.relevant += 1
      if (stage?.type === 'Offer') role.offerCount += 1

      const age = daysSince(a.createdAt)
      if (age !== null && (role.oldestActiveDays === null || age > role.oldestActiveDays)) {
        role.oldestActiveDays = age
      }
      if (age !== null && age <= 7) role.newThisWeek += 1

      const idle = daysSince(a.updatedAt)
      if (idle !== null && (role.idleDays === null || idle > role.idleDays)) {
        role.idleDays = idle
      }

      if (a.source) {
        const sc = sourceCounts.get(a.jobId)!
        sc.set(a.source, (sc.get(a.source) ?? 0) + 1)
      }
      if (a.owner) {
        const oc = ownerCounts.get(a.jobId)!
        oc.set(a.owner, (oc.get(a.owner) ?? 0) + 1)
      }
    }

    for (const role of roleMap.values()) {
      // Stalled now means "no movement in a while" (idle), a truer signal than time-open.
      role.stalled = role.idleDays !== null && role.idleDays > STALLED_DAYS

      const sc = sourceCounts.get(role.id)!
      let topSrc: string | null = null
      let topN = 0
      for (const [src, n] of sc) if (n > topN) { topN = n; topSrc = src }
      role.topSource = topSrc

      role.owners = Array.from(ownerCounts.get(role.id)!.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    }

    const roles = Array.from(roleMap.values()).sort((a, b) => b.total - a.total)

    const stageOrder = orderStageNames(stageSeen)

    const totals = {
      openRoles: roles.length,
      activeCandidates: roles.reduce((s, r) => s + r.total, 0),
      relevant: roles.reduce((s, r) => s + r.relevant, 0),
      offerStage: roles.reduce((s, r) => s + r.offerCount, 0),
      stalled: roles.filter((r) => r.stalled).length,
    }

    return NextResponse.json(
      { configured: true, view: 'open', generatedAt: new Date().toISOString(), stageOrder, totals, roles },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: String(err instanceof Error ? err.message : err), roles: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
