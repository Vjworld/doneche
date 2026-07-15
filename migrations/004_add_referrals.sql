ate/-- Migration: Referral / Gamification system
-- Adds referral tracking columns to users table.

alter table users add column if not exists referred_by uuid references users(id);
alter table users add column if not exists referral_count integer not null default 0;
alter table users add column if not exists pending_referral_toast boolean not null default false;
alter table users add column if not exists last_referral_name text;

create index if not exists idx_users_referred_by on users (referred_by);
