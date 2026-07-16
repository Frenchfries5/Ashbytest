-- Inbound job-postings tracker. Replaces the manually-maintained Google Sheet behind the
-- "Inbound Postings" tab with a table you can add/edit/delete from inside the dashboard.
-- Run once in the Supabase SQL editor.

create table if not exists inbound_postings (
  id            bigint generated always as identity primary key,
  poster        text,          -- who posted it
  date_posted   date,
  title         text,          -- posting title
  views         integer,
  applicants    integer,
  relevant      integer,
  duration_days integer,       -- how long it ran
  date_removed  date,
  role          text,          -- the role/category it supports (Growth, Core, AM, …)
  platform      text,          -- LinkedIn | Jazz | …
  paid          boolean not null default false,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists inbound_postings_date_idx on inbound_postings (date_posted);
