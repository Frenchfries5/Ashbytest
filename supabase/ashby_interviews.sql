-- Ashby interview-events sync schema. Run once in the Supabase SQL editor.
-- Safe to re-run (idempotent). Backs the "recruiter screens this week" metric (and any
-- per-stage interview count) without paginating Ashby's slow interviewSchedule.list on every
-- page load — a scheduled sync fills this table, the dashboard/email just query it.

-- Reuses the single-row site_state table (created in meetalfred.sql). Add a column for the
-- Ashby interview-schedule syncToken (Ashby's incremental cursor).
alter table site_state add column if not exists ashby_interview_sync_token text;

-- ── ashby_interviews ────────────────────────────────────────────────────────────
-- One row per completed interview EVENT (a schedule can hold several). Keyed by the Ashby
-- event id so re-syncing is idempotent. stage_title is resolved at sync time from the interview
-- plan config, so "Recruiter Screen" is filterable without a live join.
create table if not exists ashby_interviews (
  event_id        text primary key,      -- Ashby interviewEvent id
  schedule_id     text not null,
  application_id  text,
  candidate_id    text,                  -- links a person across applications (cross-pipeline)
  stage_id        text,
  stage_title     text,                  -- e.g. 'Recruiter Screen' (resolved from interview plan)
  stage_order     int,                   -- orderInInterviewPlan of the stage (for "moved forward")
  interview_id    text,
  interview_title text,
  start_time      timestamptz not null,  -- the weekly bucket key
  status          text,                  -- parent schedule status (only 'Complete' is stored)
  raw             jsonb not null,
  synced_at       timestamptz not null default now()
);

-- Columns added after initial rollout (safe to re-run).
alter table ashby_interviews add column if not exists stage_order int;
-- candidate_id links a person across applications, so an intro-call candidate who moves to a
-- real-job pipeline is credited as "moved forward" even though it's a different application.
alter table ashby_interviews add column if not exists candidate_id text;

create index if not exists ashby_interviews_start_idx on ashby_interviews (start_time);
create index if not exists ashby_interviews_stage_start_idx on ashby_interviews (stage_title, start_time);

-- ── weekly aggregate RPC ──────────────────────────────────────────────────────
-- Per (week, stage_title) event counts on/after `since`. date_trunc('week', …) is ISO
-- (Monday-start); the DB runs in UTC, matching how start_time is stored. Generic over stage,
-- so it serves recruiter-screen counts today and any other stage later.
create or replace function ashby_interviews_weekly(since timestamptz)
returns table (
  week_start  date,
  stage_title text,
  cnt         bigint
)
language sql
stable
as $$
  select date_trunc('week', start_time)::date as week_start,
         stage_title,
         count(*) as cnt
  from ashby_interviews
  where start_time >= since
  group by 1, 2
$$;
