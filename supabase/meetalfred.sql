-- MeetAlfred incremental-sync schema. Run once in the Supabase SQL editor.
-- Safe to re-run (idempotent): everything is IF NOT EXISTS / ON CONFLICT.

-- ── site_state ────────────────────────────────────────────────────────────────
-- Single-row table holding sync bookkeeping. `last_meetalfred_query` is the watermark:
-- the moment the most recent sync STARTED. Incremental syncs page back to it (minus a
-- small overlap buffer applied in code).
create table if not exists site_state (
  id                    int primary key default 1,
  last_meetalfred_query timestamptz,
  constraint site_state_singleton check (id = 1)
);

-- Seed the single row so UPDATE always has a target.
insert into site_state (id) values (1) on conflict (id) do nothing;

-- ── meetalfred_events ─────────────────────────────────────────────────────────
-- One row per API event across the 4 tracked streams (invites/accepted/messages/replies).
-- The (member_id, action_type, event_id) PK makes re-syncing idempotent — overlapping
-- windows upsert onto the same row instead of duplicating.
create table if not exists meetalfred_events (
  member_id    bigint      not null,
  member_name  text,
  action_type  text        not null,   -- 'invites' | 'accepted' | 'messages' | 'replies'
  event_id     text        not null,   -- the API's `id` (stored as text; it varies num/str)
  created_at   timestamptz not null,   -- canonical event time; the weekly bucket key
  raw          jsonb       not null,   -- full event row (incl. lead object)
  synced_at    timestamptz not null default now(),
  primary key (member_id, action_type, event_id)
);

-- Indexes for the weekly aggregation queries (window + grouping).
create index if not exists meetalfred_events_created_idx
  on meetalfred_events (created_at);
create index if not exists meetalfred_events_action_created_idx
  on meetalfred_events (action_type, created_at);

-- ── weekly aggregate RPC ──────────────────────────────────────────────────────
-- Returns per (week, member, action) counts for events on/after `since`, so the weekly
-- API route gets a small pre-aggregated result instead of thousands of raw rows.
-- date_trunc('week', ...) is ISO (Monday-start); the DB runs in UTC, matching how the
-- sync stores created_at.
create or replace function meetalfred_weekly(since timestamptz)
returns table (
  week_start  date,
  member_id   bigint,
  member_name text,
  action_type text,
  cnt         bigint
)
language sql
stable
as $$
  -- Count DISTINCT people per (week, member, action), keyed by the lead's LinkedIn URL
  -- (falling back to the event id when that's missing). So "replies" = leads who replied at
  -- all that week, not the number of reply messages — and likewise every metric is per-person.
  select date_trunc('week', created_at)::date as week_start,
         member_id,
         member_name,
         action_type,
         count(distinct coalesce(raw->'lead'->>'linkedin_profile_url', event_id)) as cnt
  from meetalfred_events
  where created_at >= since
  group by 1, 2, 3, 4
$$;

-- ── meetalfred_members ────────────────────────────────────────────────────────
-- Per-member current metadata captured on each sync. `campaigns_active` backs the
-- "N campaigns" badge/column in the Outbound tab. It's CURRENT state (not per-week
-- history), since MeetAlfred events don't carry a historical campaign count.
create table if not exists meetalfred_members (
  member_id        bigint primary key,
  name             text,
  campaigns_active int,
  updated_at       timestamptz not null default now()
);
