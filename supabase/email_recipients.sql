-- Stakeholder recipient list for the weekly Executive Summary email.
-- Managed from the /admin view (add/edit/delete). Run once in the Supabase SQL editor
-- (both local and prod databases).

create table if not exists email_recipients (
  id         bigint generated always as identity primary key,
  email      text not null unique,
  name       text,
  active     boolean not null default true,  -- pause a recipient without deleting the row
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_recipients_active_idx on email_recipients (active);

-- Weekly-email settings live on the shared single-row site_state table (created in meetalfred.sql).
-- email_feedback_prompt toggles the "we'd love your feedback" callout at the top of the email,
-- flipped from /admin. Safe to re-run.
alter table site_state add column if not exists email_feedback_prompt boolean not null default true;
