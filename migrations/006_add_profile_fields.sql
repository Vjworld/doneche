-- Migration: User professional profile + theme preference
-- Adds profile fields (editable manually or auto-filled from resume upload,
-- always reviewed/confirmed by the user before saving) plus a persisted
-- theme preference (light/dark) for the settings menu.

alter table users add column if not exists professional_title text;
alter table users add column if not exists professional_summary text;
alter table users add column if not exists skills text; -- comma-separated list
alter table users add column if not exists experience_years text;
alter table users add column if not exists theme_preference text not null default 'light'
  check (theme_preference in ('light', 'dark'));

comment on column users.professional_title is 'e.g. "Senior Product Manager" — user-entered or resume-extracted, always user-confirmed before save';
comment on column users.professional_summary is 'Short professional summary/bio, user-entered or resume-extracted';
comment on column users.skills is 'Comma-separated skill list, user-entered or resume-extracted';
comment on column users.experience_years is 'Total years of experience, user-entered or resume-extracted';
