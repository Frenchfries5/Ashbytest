-- Ashby read-through cache. Run once in the Supabase SQL editor (safe to re-run).
--
-- Why: the dashboard used to call Ashby live on every page load. A full application pull is
-- ~3.5k rows / 36 pages / ~96s, which made the Pipeline "closed roles" view especially slow.
-- These tables hold a local copy; a sync job keeps them fresh (full backfill once, then
-- incremental via Ashby's syncToken, which returns only changed rows in ~1s).
--
-- Nothing here changes a metric definition — only where the data is read from.

-- ── ashby_jobs ──────────────────────────────────────────────────────────────────
-- Open + Closed/Archived reqs, with department/location already resolved to names.
create table if not exists ashby_jobs (
  id              text primary key,
  title           text,
  status          text,          -- Open | Closed | Archived
  department      text,
  location        text,
  employment_type text,
  opened_at       timestamptz,
  openings        int,
  recruiter       text,
  raw             jsonb not null,
  synced_at       timestamptz not null default now()
);

create index if not exists ashby_jobs_status_idx on ashby_jobs (status);

-- ── ashby_applications ──────────────────────────────────────────────────────────
-- Every application across all statuses. One unscoped application.list stream covers
-- Active/Lead/Hired/Archived, so this is a single sync.
create table if not exists ashby_applications (
  id             text primary key,
  job_id         text,
  candidate_id   text,          -- links a person across applications
  candidate_name text,
  status         text,          -- Active | Lead | Hired | Archived
  stage_title    text,
  stage_type     text,          -- PreInterviewScreen | Active | Offer | Hired | Archived …
  stage_order    int,
  source         text,
  owner          text,          -- creditedToUser
  archive_reason text,
  created_at     timestamptz,   -- applied date (weekly inbound buckets)
  updated_at     timestamptz,   -- last transition (hire-date approximation for Hired)
  raw            jsonb not null,
  synced_at      timestamptz not null default now()
);

create index if not exists ashby_applications_job_idx on ashby_applications (job_id);
create index if not exists ashby_applications_status_idx on ashby_applications (status);
create index if not exists ashby_applications_created_idx on ashby_applications (created_at);
create index if not exists ashby_applications_updated_idx on ashby_applications (updated_at);
create index if not exists ashby_applications_candidate_idx on ashby_applications (candidate_id);

-- ── sync bookkeeping ────────────────────────────────────────────────────────────
-- Reuses the single-row site_state table (created in meetalfred.sql). The tokens are Ashby's
-- incremental cursors; ashby_synced_at drives the "last synced" label and the on-load
-- revalidate throttle.
alter table site_state add column if not exists ashby_app_sync_token text;
alter table site_state add column if not exists ashby_job_sync_token text;
alter table site_state add column if not exists ashby_synced_at timestamptz;
