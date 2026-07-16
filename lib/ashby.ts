// Server-only Ashby API client.
//
// Ashby (https://api.ashbyhq.com) is POST-only, authenticated with HTTP Basic auth
// where the API key is the username and the password is blank. It has no CORS and the
// key is long-lived, so every call here MUST run server-side (route handlers only) —
// never import this into a client component.
//
// Field shapes below are confirmed against the live API. Two quirks worth remembering:
//   • job.list wants `status` as an ARRAY (["Open"]); application.list wants it as a
//     STRING ("Active"). They are genuinely inconsistent.
//   • Jobs/applications carry departmentId / locationId (not names); resolve via
//     department.list / location.list. currentInterviewStage is included on applications
//     by default (do NOT pass it in `expand` — that errors as invalid_input).

const ASHBY_BASE = 'https://api.ashbyhq.com'

// ── Relevance approximation ─────────────────────────────────────────────────────
// The old sheet tracked "relevant" applicants as a manual human judgment. The API has no
// such concept, so we approximate: an application is "relevant" once it has advanced past
// raw application review into the active pipeline.
//
// Ashby's stage `type` is coarse (confirmed live): `PreInterviewScreen` = applications not
// yet reviewed by a recruiter; `Active` = the whole interview funnel (Recruiter Screen →
// Hiring Manager Screen → interviews); `Offer` / `Hired` = terminal-positive; `Lead` and
// `Archived` are excluded. So "relevant" = a recruiter engaged and moved them forward.
// This is the single knob to retune.
export const RELEVANT_STAGE_TYPES = new Set(['Active', 'Offer', 'Hired'])

// Once an application is Archived, its currentInterviewStage.type flips to "Archived" —
// erasing how far it actually got. Walking full stage history to recover that is too slow
// to do in bulk (a 20-way parallel batch of application.info calls took ~3.7s; a job with a
// few hundred archived applicants would take 30-60s+, unworkable for a route that also
// auto-revalidates every few minutes). archiveReason is already fetched for free and is a
// solid proxy for "did a human engage them past initial review before rejecting."
// Confirmed reasons that only occur after a candidate has been screened/interviewed:
const RELEVANT_ARCHIVE_REASON_PATTERNS: RegExp[] = [
  /no show/i,                 // scheduled for an interview
  /compensation/i,            // comp is discussed at interview/offer stage
  /accepted other offer/i,    // got far enough to have competing offers
  /interviewing for another role/i,
  /timing not aligned/i,
  /role not aligned/i,        // learned during a conversation, not from the resume alone
  /strong candidate/i,        // explicit finalist language
]
export function isRelevantArchiveReason(reason: string | null): boolean {
  if (!reason) return false
  return RELEVANT_ARCHIVE_REASON_PATTERNS.some((re) => re.test(reason))
}

// A role is flagged "stalled" when its oldest active candidate has sat this many days.
export const STALLED_DAYS = 30

// ── Config ──────────────────────────────────────────────────────────────────────
export function ashbyConfigured(): boolean {
  return !!process.env.ASHBY_API_KEY
}

function authHeader(): string {
  const key = process.env.ASHBY_API_KEY ?? ''
  return 'Basic ' + Buffer.from(`${key}:`).toString('base64')
}

// ── Low-level POST ──────────────────────────────────────────────────────────────
interface AshbyEnvelope<T> {
  success: boolean
  results?: T
  moreDataAvailable?: boolean
  nextCursor?: string
  errors?: unknown
}

export async function ashbyPost<T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<AshbyEnvelope<T>> {
  const res = await fetch(`${ASHBY_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ashby ${endpoint} HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = (await res.json()) as AshbyEnvelope<T>
  if (!json.success) {
    throw new Error(`Ashby ${endpoint} returned success:false — ${JSON.stringify(json.errors ?? '').slice(0, 300)}`)
  }
  return json
}

// Loops over cursor pagination and accumulates every `results` row. Hard-capped so a
// runaway pull can't spin forever.
const MAX_PAGES = 50

export async function ashbyPaginate<T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const env = await ashbyPost<T[]>(endpoint, { ...body, cursor: cursor ?? undefined })
    if (Array.isArray(env.results)) out.push(...env.results)
    if (!env.moreDataAvailable || !env.nextCursor) break
    cursor = env.nextCursor
  }
  return out
}

// ── Raw shapes (confirmed against live API, still defensive) ─────────────────────
interface RawHiringTeamMember {
  firstName?: string
  lastName?: string
  role?: string
}
export interface RawJob {
  id: string
  title?: string
  status?: string
  departmentId?: string
  locationId?: string
  employmentType?: string
  openedAt?: string
  createdAt?: string
  openings?: unknown[]
  hiringTeam?: RawHiringTeamMember[]
  [k: string]: unknown
}

export interface RawStage {
  id?: string
  title?: string
  type?: string
  orderInInterviewPlan?: number
  [k: string]: unknown
}

interface RawEmbeddedJob {
  id?: string
  title?: string
  departmentId?: string
  locationId?: string
}
export interface RawApplication {
  id: string
  status?: string
  createdAt?: string
  updatedAt?: string
  job?: RawEmbeddedJob
  currentInterviewStage?: RawStage
  candidate?: { id?: string; name?: string }
  source?: string | { title?: string; sourceType?: { title?: string } } | null
  creditedToUser?: { firstName?: string; lastName?: string }
  archiveReason?: { text?: string; title?: string } | string | null
  [k: string]: unknown
}

interface RawHistoryEntry {
  stageNumber?: number
  title?: string
  enteredStageAt?: string
  leftStageAt?: string | null
}

interface RawNamed {
  id: string
  name?: string
  isArchived?: boolean
}

// ── Normalized shapes consumed by routes ────────────────────────────────────────
export interface Job {
  id: string
  title: string
  status: string | null
  department: string | null
  location: string | null
  employmentType: string | null
  openedAt: string | null
  openings: number | null
  recruiter: string | null
}

export interface Stage {
  title: string
  type: string | null
  order: number | null
}

export interface Application {
  id: string
  status: string | null
  createdAt: string | null
  updatedAt: string | null
  jobId: string | null
  stage: Stage | null
  source: string | null
  owner: string | null
  archiveReason: string | null
}

export interface Candidate {
  applicationId: string
  name: string
  stage: Stage | null
  status: string | null
  appliedAt: string | null
  daysInPipeline: number | null
  daysSinceActivity: number | null
  timeInCurrentStageDays: number | null // filled in via applicationHistory when requested
  source: string | null
}

// One application across the full funnel (any status) — for source/outcome analysis.
export interface JobApplication {
  id: string
  name: string
  status: string | null // Active | Lead | Hired | Archived
  source: string | null
  stage: Stage | null // current stage
  archiveReason: string | null
  createdAt: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// "FullTime" -> "Full Time", "Intern" -> "Intern"
function prettyEmploymentType(v: string | null): string | null {
  if (!v) return null
  return v.replace(/([a-z])([A-Z])/g, '$1 $2')
}

async function idNameMap(endpoint: string): Promise<Map<string, string>> {
  const rows = await ashbyPaginate<RawNamed>(endpoint, {})
  const m = new Map<string, string>()
  for (const r of rows) if (r?.id && r.name) m.set(r.id, r.name)
  return m
}

// ── Normalizers ─────────────────────────────────────────────────────────────────
function normalizeJob(j: RawJob, depts: Map<string, string>, locs: Map<string, string>): Job {
  let recruiter: string | null = null
  if (Array.isArray(j.hiringTeam) && j.hiringTeam.length) {
    const pick = j.hiringTeam.find((m) => /recruit/i.test(m.role ?? '')) ?? j.hiringTeam[0]
    recruiter = str([pick?.firstName, pick?.lastName].filter(Boolean).join(' '))
  }
  return {
    id: j.id,
    title: str(j.title) ?? 'Untitled role',
    status: str(j.status),
    department: (j.departmentId && depts.get(j.departmentId)) || null,
    location: (j.locationId && locs.get(j.locationId)) || null,
    employmentType: prettyEmploymentType(str(j.employmentType)),
    openedAt: str(j.openedAt) ?? str(j.createdAt),
    openings: Array.isArray(j.openings) ? j.openings.length : null,
    recruiter,
  }
}

function normalizeStage(s: RawStage | undefined): Stage | null {
  if (!s) return null
  const title = str(s.title)
  if (!title) return null
  return {
    title,
    type: str(s.type),
    order: typeof s.orderInInterviewPlan === 'number' ? s.orderInInterviewPlan : null,
  }
}

function normalizeOwner(u: RawApplication['creditedToUser']): string | null {
  if (!u) return null
  return str([u.firstName, u.lastName].filter(Boolean).join(' '))
}

function normalizeArchiveReason(r: RawApplication['archiveReason']): string | null {
  if (!r) return null
  if (typeof r === 'string') return str(r)
  return str(r.text) ?? str(r.title)
}

function normalizeApplication(a: RawApplication): Application {
  return {
    id: a.id,
    status: str(a.status),
    createdAt: str(a.createdAt),
    updatedAt: str(a.updatedAt),
    jobId: str(a.job?.id),
    stage: normalizeStage(a.currentInterviewStage),
    source: normalizeSource(a.source),
    owner: normalizeOwner(a.creditedToUser),
    archiveReason: normalizeArchiveReason(a.archiveReason),
  }
}

function normalizeJobApplication(a: RawApplication): JobApplication {
  return {
    id: a.id,
    name: str(a.candidate?.name) ?? 'Unnamed candidate',
    status: str(a.status),
    source: normalizeSource(a.source),
    stage: normalizeStage(a.currentInterviewStage),
    archiveReason: normalizeArchiveReason(a.archiveReason),
    createdAt: str(a.createdAt),
  }
}

const MS_PER_DAY = 1000 * 60 * 60 * 24
function daysSinceIso(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / MS_PER_DAY))
}

function normalizeSource(s: RawApplication['source']): string | null {
  if (!s) return null
  if (typeof s === 'string') return str(s)
  return str(s.title) ?? str(s.sourceType?.title)
}

function normalizeCandidate(a: RawApplication): Candidate {
  const appliedAt = str(a.createdAt)
  return {
    applicationId: a.id,
    name: str(a.candidate?.name) ?? 'Unnamed candidate',
    stage: normalizeStage(a.currentInterviewStage),
    status: str(a.status),
    appliedAt,
    daysInPipeline: daysSinceIso(appliedAt),
    daysSinceActivity: daysSinceIso(str(a.updatedAt)),
    timeInCurrentStageDays: null,
    source: normalizeSource(a.source),
  }
}

// Canonical funnel ordering — stages matched case-insensitively so the order holds
// regardless of the exact custom stage names configured in Ashby. Shared by the pipeline
// overview and the per-job drill-down so both render stages in the same order.
// Patterns (not bare substrings) so e.g. "Leadership Interview" ranks as an interview, not
// a lead (`\blead\b` won't match inside "leadership").
const STAGE_ORDER_PATTERNS: RegExp[] = [
  /\blead\b|sourced/i,           // Lead / sourced
  /applicat/i,                   // Application Review, New Applicant
  /screen/i,                     // Recruiter Screen, Hiring Manager Screen
  /assessment|exercise|take[- ]?home/i,
  /interview/i,                  // Leadership Interview, Team Interviews
  /offer/i,
  /hire/i,                       // Hired
]
export function stageRank(name: string): number {
  const idx = STAGE_ORDER_PATTERNS.findIndex((re) => re.test(name))
  return idx === -1 ? STAGE_ORDER_PATTERNS.length : idx
}
export function orderStageNames(names: Iterable<string>): string[] {
  return Array.from(new Set(names)).sort((a, b) => {
    const r = stageRank(a) - stageRank(b)
    return r !== 0 ? r : a.localeCompare(b)
  })
}

export function isRelevantStage(stage: Stage | null): boolean {
  if (!stage?.type) return false
  return RELEVANT_STAGE_TYPES.has(stage.type)
}

// Full relevance check for an application across ANY status. For Active/Lead/Hired,
// current stage is accurate and used directly. For Archived, current stage has decayed to
// "Archived" regardless of how far the candidate got, so we fall back to archiveReason —
// otherwise every application eventually reads as "not relevant" once resolved, which is
// what caused historical weeks to trend toward 0% relevance as their cohorts got archived.
export function isRelevantApplication(a: { status: string | null; stage: Stage | null; archiveReason: string | null }): boolean {
  if (a.status === 'Hired') return true
  if (isRelevantStage(a.stage)) return true
  if (a.status === 'Archived') return isRelevantArchiveReason(a.archiveReason)
  return false
}

// ── Typed wrappers ──────────────────────────────────────────────────────────────
export async function listOpenJobs(): Promise<Job[]> {
  const [raw, depts, locs] = await Promise.all([
    ashbyPaginate<RawJob>('job.list', { status: ['Open'], limit: 100, expand: ['openings'] }),
    idNameMap('department.list'),
    idNameMap('location.list'),
  ])
  return raw.map((j) => normalizeJob(j, depts, locs))
}

// Closed + Archived jobs — for the Pipeline tab's "closed roles" view (post-hoc source &
// rejection analysis on finished searches).
export async function listClosedJobs(): Promise<Job[]> {
  const [raw, depts, locs] = await Promise.all([
    ashbyPaginate<RawJob>('job.list', { status: ['Closed', 'Archived'], limit: 100, expand: ['openings'] }),
    idNameMap('department.list'),
    idNameMap('location.list'),
  ])
  return raw.map((j) => normalizeJob(j, depts, locs))
}

// application.list takes a single status string. Fetch the given statuses and merge.
async function listApplicationsByStatus(status: string, jobId?: string): Promise<RawApplication[]> {
  const body: Record<string, unknown> = { status, limit: 100 }
  if (jobId) body.jobId = jobId
  return ashbyPaginate<RawApplication>('application.list', body)
}

// Active + Lead applications (current pipeline). currentInterviewStage is included by default.
export async function listActiveApplications(jobId?: string): Promise<Application[]> {
  const [active, lead] = await Promise.all([
    listApplicationsByStatus('Active', jobId),
    listApplicationsByStatus('Lead', jobId),
  ])
  return [...active, ...lead].map(normalizeApplication)
}

// Candidate-level detail (name, stage, age, source) for one job's active pipeline.
export async function listJobCandidates(jobId: string): Promise<Candidate[]> {
  const [active, lead] = await Promise.all([
    listApplicationsByStatus('Active', jobId),
    listApplicationsByStatus('Lead', jobId),
  ])
  return [...active, ...lead].map(normalizeCandidate)
}

// Every application for a job across the full funnel — for source & outcome analysis.
export async function listAllJobApplications(jobId: string): Promise<JobApplication[]> {
  const statuses = ['Active', 'Lead', 'Hired', 'Archived']
  const pages = await Promise.all(statuses.map((s) => listApplicationsByStatus(s, jobId)))
  return pages.flat().map(normalizeJobApplication)
}

// Days the application has sat in its CURRENT stage (the history entry not yet left).
export async function getDaysInCurrentStage(applicationId: string): Promise<number | null> {
  try {
    const env = await ashbyPost<{ applicationHistory?: RawHistoryEntry[] }>('application.info', { applicationId })
    const history = env.results?.applicationHistory
    if (!Array.isArray(history)) return null
    const current = history.find((h) => !h.leftStageAt)
    return current ? daysSinceIso(str(current.enteredStageAt)) : null
  } catch {
    return null
  }
}

// Run async `fn` over `items` with bounded concurrency (keeps per-candidate history
// lookups from firing hundreds of requests at once).
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// One open job's fully-resolved metadata (department/location names, recruiter, etc.).
export async function getOpenJob(jobId: string): Promise<Job | null> {
  const jobs = await listOpenJobs()
  return jobs.find((j) => j.id === jobId) ?? null
}

// All applications created since `createdAfterMs` (Unix ms), any status — used to
// reconstruct weekly applicant/relevant history. Optionally scoped to one job.
export async function listApplicationsSince(
  createdAfterMs: number,
  jobId?: string
): Promise<Application[]> {
  const body: Record<string, unknown> = { createdAfter: createdAfterMs, limit: 100 }
  if (jobId) body.jobId = jobId
  const raw = await ashbyPaginate<RawApplication>('application.list', body)
  return raw.map(normalizeApplication)
}
