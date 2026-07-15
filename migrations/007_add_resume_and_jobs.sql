-- Migration: Resume storage + curated Jobs matching + in-app Apply
-- Adds full resume text/filename to users (used to derive matching keywords),
-- and a "jobs" table of curated postings that users can view and apply to
-- directly from doneche. A simple keyword-overlap match score is computed
-- at request time in the app layer (no extra column needed).

alter table users add column if not exists resume_filename text;
alter table users add column if not exists resume_text text; -- extracted plain text from uploaded resume (pdf/docx/md)
alter table users add column if not exists resume_uploaded_at timestamptz;

comment on column users.resume_filename is 'Original filename of the last uploaded resume (pdf/docx/md)';
comment on column users.resume_text is 'Extracted plain text from the resume, used to derive curated job matches';
comment on column users.resume_uploaded_at is 'Timestamp of the last resume upload';

create table if not exists jobs (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  company text not null,
  domain text not null,            -- e.g. "Product Management", "Software Engineering"
  location text,
  job_type text check (job_type in ('WFO', 'Remote', 'Hybrid') or job_type is null),
  ctc_lpa text,
  skills text not null,            -- comma-separated required skills/keywords
  description text,
  apply_url text,                  -- external application link (opened when user clicks Apply)
  created_at timestamptz not null default now()
);

create index if not exists idx_jobs_domain on jobs (domain);

alter table jobs enable row level security;
create policy "Jobs are publicly readable" on jobs for select using (true);

-- Track jobs a user has applied to via the curated Jobs page, separately from
-- the general application funnel/kanban tracked in "applications".
create table if not exists job_applications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  applied_at timestamptz not null default now(),
  unique (user_id, job_id)
);

alter table job_applications enable row level security;
create policy "Users can view own job applications" on job_applications
  for select using (auth.uid()::text = user_id::text);

-- Seed a handful of curated jobs so the matching feature is demoable
-- out of the box. Safe to re-run (guarded by NOT EXISTS on title+company).
insert into jobs (title, company, domain, location, job_type, ctc_lpa, skills, description, apply_url)
select * from (values
  ('Senior Product Manager', 'Northwind Analytics', 'Product Management', 'Bangalore', 'Hybrid', '28-35', 'product strategy, stakeholder management, roadmapping, sql, user research, agile', 'Own the roadmap for a B2B analytics suite used by 500+ enterprise customers.', 'https://example.com/jobs/senior-pm-northwind'),
  ('Product Manager - Growth', 'Loopline', 'Product Management', 'Remote', 'Remote', '18-24', 'growth, a/b testing, sql, analytics, product strategy, experimentation', 'Drive activation and retention experiments across the funnel.', 'https://example.com/jobs/pm-growth-loopline'),
  ('Software Engineer - Backend', 'Vertex Cloud', 'Software Engineering', 'Pune', 'Hybrid', '15-22', 'node.js, postgresql, api design, microservices, aws, docker', 'Build and scale backend services for a fintech platform.', 'https://example.com/jobs/backend-vertex'),
  ('Full Stack Developer', 'Brightpath', 'Software Engineering', 'Remote', 'Remote', '12-18', 'javascript, react, node.js, express, mongodb, rest api', 'Ship features end-to-end for a fast-growing HR tech startup.', 'https://example.com/jobs/fullstack-brightpath'),
  ('Data Analyst', 'Marketwise', 'Data & Analytics', 'Mumbai', 'WFO', '8-12', 'sql, excel, tableau, python, data visualization, statistics', 'Turn raw transaction data into actionable business insights.', 'https://example.com/jobs/data-analyst-marketwise'),
  ('HR Business Partner', 'Solace HR', 'Human Resources', 'Delhi', 'WFO', '14-20', 'stakeholder management, employee relations, hr policy, performance management, organizational effectiveness', 'Partner with leadership to drive org design and talent strategy.', 'https://example.com/jobs/hrbp-solace'),
  ('Marketing Manager', 'Fable & Co', 'Marketing', 'Bangalore', 'Hybrid', '16-22', 'content strategy, seo, campaign management, brand marketing, analytics', 'Lead brand campaigns across digital channels for a D2C label.', 'https://example.com/jobs/marketing-mgr-fable'),
  ('UX Designer', 'Northwind Analytics', 'Design', 'Remote', 'Remote', '14-20', 'figma, user research, prototyping, interaction design, design systems', 'Design intuitive workflows for enterprise analytics dashboards.', 'https://example.com/jobs/ux-designer-northwind')
) as v(title, company, domain, location, job_type, ctc_lpa, skills, description, apply_url)
where not exists (
  select 1 from jobs j where j.title = v.title and j.company = v.company
);
