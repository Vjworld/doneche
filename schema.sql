-- doneche — Supabase (PostgreSQL) schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "uuid-ossp";

-- ============ USERS ============
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_email on users (email);

-- ============ APPLICATIONS ============
-- status drives the Kanban board: Applied -> Interviewing -> Ghosted -> Rejected -> Offered
create table if not exists applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users (id) on delete cascade,
  company text not null,
  role text not null,
  applied_date date not null default current_date,
  -- last_update drives the 7-day "Ghosted" auto-flag logic:
  -- if status IN ('Applied','Interviewing') AND now() - last_update >= 7 days -> auto-flag 'Ghosted'
  last_update timestamptz not null default now(),
  status text not null default 'Applied'
    check (status in ('Applied', 'Interviewing', 'Ghosted', 'Rejected', 'Offered')),
  ghosted_at timestamptz,
  created_at timestamptz not null default now(),
  -- Optional metadata fields shown in the card detail modal
  location text,
  ctc_lpa text,
  job_type text check (job_type in ('WFO', 'Remote', 'Hybrid') or job_type is null),
  hr_contact text,
  notes text
);


create index if not exists idx_applications_user_id on applications (user_id);
create index if not exists idx_applications_status on applications (status);
-- Speeds up the daily "find stale Applied/Interviewing cards" ghost-detection scan
create index if not exists idx_applications_ghost_scan
  on applications (status, last_update)
  where status in ('Applied', 'Interviewing');

-- Auto-maintain updated_at on users
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ============ ROW LEVEL SECURITY ============
-- Enable RLS; app talks to Supabase via service role from Netlify functions,
-- so these policies matter mainly if you later expose the anon/public key directly.
alter table users enable row level security;
alter table applications enable row level security;

create policy "Users can view own row" on users
  for select using (auth.uid()::text = id::text);

create policy "Applications belong to owner" on applications
  for all using (auth.uid()::text = user_id::text);

-- ============ OPTIONAL: server-side ghost-flagging function ============
-- Can be called on a schedule (Supabase cron / pg_cron) or from a Netlify
-- scheduled function as a backup to the on-request check in the app.
create or replace function flag_ghosted_applications()
returns integer as $$
declare
  updated_count integer;
begin
  update applications
  set status = 'Ghosted', ghosted_at = now()
  where status in ('Applied', 'Interviewing')
    and now() - last_update >= interval '7 days';

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$ language plpgsql;
