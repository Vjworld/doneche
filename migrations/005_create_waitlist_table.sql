-- Migration: Waitlist table for "Coming Soon" job-matchmaking feature
-- Captures early-access signups from the /coming-soon page.

create table if not exists waitlist (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  user_id uuid references users(id) on delete set null,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists idx_waitlist_email on waitlist (email);

alter table waitlist enable row level security;

create policy "Users can view own waitlist entry" on waitlist
  for select using (auth.uid()::text = user_id::text);
