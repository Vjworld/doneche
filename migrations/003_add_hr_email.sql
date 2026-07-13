-- Migration: add hr_email column to applications table
-- Run this in the Supabase SQL editor.

alter table applications
  add column if not exists hr_email text;
