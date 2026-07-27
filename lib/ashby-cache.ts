// Read layer over the Ashby cache tables (ashby_jobs / ashby_applications).
//
// Returns the same normalized shapes lib/ashby.ts produces (Job, Application, JobApplication,
// Candidate), so consumers keep their existing logic — only the data source changed. Every
// function returns null when the cache is unavailable (tables missing / not yet created), which
// callers surface as an unconfigured/empty state rather than crashing.

import { supabase } from './supabase'
import type { Application, Candidate, Job, JobApplication, Stage } from './ashby'

const APP_COLUMNS =
  'id, job_id, candidate_id, candidate_name, status, stage_title, stage_type, stage_order, source, owner, archive_reason, created_at, updated_at'
const JOB_COLUMNS =
  'id, title, status, department, location, employment_type, opened_at, openings, recruiter'

// Supabase caps a single select at 1000 rows by default; page explicitly so a ~3.5k-row table
// comes back complete.
const PAGE = 1000

export interface CachedAppRow {
  id: string
  job_id: string | null
  candidate_id: string | null
  candidate_name: string | null
  status: string | null
  stage_title: string | null
  stage_type: string | null
  stage_order: number | null
  source: string | null
  owner: string | null
  archive_reason: string | null
  created_at: string | null
  updated_at: string | null
}

interface CachedJobRow {
  id: string
  title: string | null
  status: string | null
  department: string | null
  location: string | null
  employment_type: string | null
  opened_at: string | null
  openings: number | null
  recruiter: string | null
}

const MS_PER_DAY = 86_400_000
function daysSinceIso(isoStr: string | null): number | null {
  if (!isoStr) return null
  const t = Date.parse(isoStr)
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / MS_PER_DAY))
}

function toStage(r: CachedAppRow): Stage | null {
  if (!r.stage_title) return null
  return { title: r.stage_title, type: r.stage_type, order: r.stage_order }
}

export function toApplication(r: CachedAppRow): Application {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    jobId: r.job_id,
    stage: toStage(r),
    source: r.source,
    owner: r.owner,
    archiveReason: r.archive_reason,
  }
}

export function toJobApplication(r: CachedAppRow): JobApplication {
  return {
    id: r.id,
    name: r.candidate_name ?? 'Unnamed candidate',
    status: r.status,
    source: r.source,
    stage: toStage(r),
    archiveReason: r.archive_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function toCandidate(r: CachedAppRow): Candidate {
  return {
    applicationId: r.id,
    name: r.candidate_name ?? 'Unnamed candidate',
    stage: toStage(r),
    status: r.status,
    appliedAt: r.created_at,
    daysInPipeline: daysSinceIso(r.created_at),
    daysSinceActivity: daysSinceIso(r.updated_at),
    timeInCurrentStageDays: null, // filled in live by the drawer's analysis path
    source: r.source,
  }
}

function toJob(r: CachedJobRow): Job {
  return {
    id: r.id,
    title: r.title ?? 'Untitled role',
    status: r.status,
    department: r.department,
    location: r.location,
    employmentType: r.employment_type,
    openedAt: r.opened_at,
    openings: r.openings,
    recruiter: r.recruiter,
  }
}

// ── application queries ─────────────────────────────────────────────────────────
interface AppFilter {
  statuses?: string[]
  jobId?: string
  createdAfterMs?: number
}

// Page through matching applications. null = cache unavailable.
export async function queryApplications(filter: AppFilter = {}): Promise<CachedAppRow[] | null> {
  const out: CachedAppRow[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('ashby_applications').select(APP_COLUMNS).range(from, from + PAGE - 1)
    if (filter.statuses?.length) q = q.in('status', filter.statuses)
    if (filter.jobId) q = q.eq('job_id', filter.jobId)
    if (filter.createdAfterMs) q = q.gte('created_at', new Date(filter.createdAfterMs).toISOString())
    const { data, error } = await q
    if (error) return null
    const rows = (data ?? []) as unknown as CachedAppRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function cachedActiveApplications(jobId?: string): Promise<Application[] | null> {
  const rows = await queryApplications({ statuses: ['Active', 'Lead'], jobId })
  return rows && rows.map(toApplication)
}

export async function cachedJobCandidates(jobId: string): Promise<Candidate[] | null> {
  const rows = await queryApplications({ statuses: ['Active', 'Lead'], jobId })
  return rows && rows.map(toCandidate)
}

export async function cachedAllJobApplications(jobId: string): Promise<JobApplication[] | null> {
  const rows = await queryApplications({ jobId })
  return rows && rows.map(toJobApplication)
}

export async function cachedHiredApplications(): Promise<JobApplication[] | null> {
  const rows = await queryApplications({ statuses: ['Hired'] })
  return rows && rows.map(toJobApplication)
}

export async function cachedApplicationsSince(createdAfterMs: number, jobId?: string): Promise<Application[] | null> {
  const rows = await queryApplications({ createdAfterMs, jobId })
  return rows && rows.map(toApplication)
}

// ── job queries ─────────────────────────────────────────────────────────────────
async function queryJobs(statuses: string[]): Promise<Job[] | null> {
  const { data, error } = await supabase.from('ashby_jobs').select(JOB_COLUMNS).in('status', statuses)
  if (error) return null
  return ((data ?? []) as unknown as CachedJobRow[]).map(toJob)
}

export async function cachedOpenJobs(): Promise<Job[] | null> {
  return queryJobs(['Open'])
}

export async function cachedClosedJobs(): Promise<Job[] | null> {
  return queryJobs(['Closed', 'Archived'])
}

// True once the cache has any applications — used to distinguish "not backfilled yet" from
// "genuinely zero results".
export async function cacheHasData(): Promise<boolean> {
  const { count, error } = await supabase
    .from('ashby_applications')
    .select('id', { count: 'exact', head: true })
  if (error) return false
  return (count ?? 0) > 0
}
