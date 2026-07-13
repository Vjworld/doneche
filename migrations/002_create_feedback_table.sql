-- Migration: create feedback table for beta tester bug reports / feature requests
-- Run this in the Supabase SQL editor.

create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users (id) on delete set null,
  feedback_type text not null check (feedback_type in ('Bug', 'Feature Request', 'General')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_user_id on feedback (user_id);

alter table feedback enable row level security;

create policy "Users can view own feedback" on feedback
  for select using (auth.uid()::text = user_id::text);
