import { GROWTH_ROLE_TITLE } from './ashby'
import { cachedOpenJobs, cachedActiveApplications } from './ashby-cache'

export interface PipelineOutcomes {
  offerStage: number             // active candidates in an Offer stage (open roles)
  growthPipeline: number | null  // active candidates in the Growth role(s); null if no open Growth role
}

// Offer-stage count + Growth-role active pipeline total, read from the Supabase cache. Scoped to
// OPEN jobs, matching the pipeline route's totals so the dashboard and the email agree. Returns
// null when the cache is unavailable (not yet created/backfilled).
export async function getPipelineOutcomes(): Promise<PipelineOutcomes | null> {
  const [jobs, apps] = await Promise.all([cachedOpenJobs(), cachedActiveApplications()])
  if (!jobs || !apps) return null
  const openJobIds = new Set(jobs.map((j) => j.id))
  const growthJobIds = new Set(jobs.filter((j) => GROWTH_ROLE_TITLE.test(j.title)).map((j) => j.id))
  let offerStage = 0
  let growthPipeline = 0
  for (const a of apps) {
    if (!a.jobId || !openJobIds.has(a.jobId)) continue
    if (a.stage?.type === 'Offer') offerStage += 1
    if (growthJobIds.has(a.jobId)) growthPipeline += 1
  }
  return { offerStage, growthPipeline: growthJobIds.size ? growthPipeline : null }
}
