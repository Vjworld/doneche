-- Migration: Password reset tokens (server-managed, works regardless of
-- whether Supabase Auth is configured client-side).
alter table users add column if not exists reset_token text;
alter table users add column if not exists reset_token_expires timestamptz;

create index if not exists idx_users_reset_token on users (reset_token);
