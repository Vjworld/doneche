-- Migration: add optional metadata fields to applications table
-- Safe to run on an existing Supabase database (idempotent via IF NOT EXISTS).
-- Run this in the Supabase SQL editor if your applications table was created
-- before these columns were added to schema.sql.

alter table applications add column if not exists location text;
alter table applications add column if not exists ctc_lpa text;
alter table applications add column if not exists job_type text;
alter table applications add column if not exists hr_contact text;
alter table applications add column if not exists notes text;

-- Optional: enforce allowed job_type values (skip if you want free-form text)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_job_type_check'
  ) then
    alter table applications
      add constraint applications_job_type_check
      check (job_type in ('WFO', 'Remote', 'Hybrid') or job_type is null);
  end if;
end $$;
