require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

let Anthropic;
let anthropicClient = null;
if (process.env.ANTHROPIC_API_KEY) {
  Anthropic = require('@anthropic-ai/sdk');
  anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const CLAUDE_MODEL = 'claude-3-haiku-20240307';

function extractJsonFromClaudeText(text) {
  if (!text) return null;
  // Strip markdown fences if present, and find first {...} block
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : cleaned;
  try {
    return JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse Claude JSON response:', err, text);
    return null;
  }
}

// Mandatory Kanban card fields we try to auto-fill via Magic Upload: company, role, appliedDate.
// Optional metadata fields (location, ctcLpa, jobType, hrContact, hrEmail) are also extracted
// opportunistically when present in the source document.
const MAGIC_UPLOAD_SYSTEM_INSTRUCTIONS =
  'Extract structured job application details. Return ONLY a valid JSON object (no markdown fences) with these exact keys: ' +
  'company (string), role (string), appliedDate (string, ISO format YYYY-MM-DD — infer from any visible date in the document; ' +
  'if no date is visible, use today\'s date), location (string or empty string), ctcLpa (string or empty string), ' +
  'jobType (one of "WFO", "Remote", "Hybrid", or empty string), hrContact (string or empty string), hrEmail (string or empty string). ' +
  'Always include all keys even if empty.';

async function parseScreenshotWithClaude(base64Image, mediaType) {
  if (!anthropicClient) throw new Error('Anthropic client not configured (ANTHROPIC_API_KEY missing).');
  const response = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    system:
      'Analyze this job application confirmation screenshot. ' + MAGIC_UPLOAD_SYSTEM_INSTRUCTIONS,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType || 'image/png',
              data: base64Image
            }
          },
          {
            type: 'text',
            text: 'Extract the required job application fields from this screenshot.'
          }
        ]
      }
    ]
  });
  const text = response.content && response.content[0] && response.content[0].text;
  return extractJsonFromClaudeText(text);
}

async function parseTextWithClaude(emailText) {

  if (!anthropicClient) throw new Error('Anthropic client not configured (ANTHROPIC_API_KEY missing).');
  const response = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    system:
      'Analyze this job application confirmation email. ' + MAGIC_UPLOAD_SYSTEM_INSTRUCTIONS,
    messages: [
      {
        role: 'user',
        content: emailText
      }
    ]
  });
  const text = response.content && response.content[0] && response.content[0].text;
  return extractJsonFromClaudeText(text);
}


const GHOST_DAYS = 7; // days of silence before auto-flag


// ---------- Data layer ----------
// Uses Supabase (Postgres) when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set
// (Netlify production), otherwise falls back to a local lowdb JSON file
// (local development only — see server.js).
let db;
let useSupabase = false;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  useSupabase = true;
  const { createClient } = require('@supabase/supabase-js');
  db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function daysSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// ---------- Email notifications (Nodemailer / Gmail) ----------
const FEEDBACK_ALERT_EMAIL = 'vaibhavseluk@gmail.com';

const mailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

async function sendFeedbackAlertEmail({ userIdentifier, feedbackType, message }) {
  try {
    await mailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: FEEDBACK_ALERT_EMAIL,
      subject: `🚨 New Doneche Feedback: ${feedbackType}`,
      text: `A new feedback submission has been received on Doneche.

User ID/Email: ${userIdentifier}
Feedback Type: ${feedbackType}

Message:
${message}
`
    });
  } catch (err) {
    console.error('Failed to send feedback alert email:', err);
  }
}


function followUpTemplate(application) {
  const greeting = application.hrContact ? `Hi ${application.hrContact.split(' ')[0]},` : 'Hi there,';
  return `Subject: Following up on my application for ${application.role} at ${application.company}

${greeting}


I hope you're doing well. I wanted to follow up on my application for the ${application.role} position at ${application.company}, submitted on ${new Date(
    application.appliedDate || application.applied_date
  ).toLocaleDateString()}. I remain very interested in the opportunity and would love to hear about next steps whenever convenient.

Please let me know if there's any additional information I can provide.

Best regards,
[Your Name]`;
}

const app = express();

// Trust Netlify's proxy so secure cookies / rate-limit IP detection work correctly.
app.set('trust proxy', 1);

// ---------- Security headers (Helmet) ----------
app.use(
  helmet({
    contentSecurityPolicy: false, // app relies on several external CDN scripts (driver.js, canvas-confetti, supabase-js)
    crossOriginEmbedderPolicy: false
  })
);

// ---------- Rate limiting ----------
// General API/auth rate limiter to slow down brute-force / abuse.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' }
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' }
});

app.set('view engine', 'ejs');

// In the bundled Netlify function, included_files preserve their path
// relative to the project base directory (LAMBDA_TASK_ROOT), NOT relative
// to this file's location inside netlify/functions. Resolve accordingly.
const viewsDir = process.env.LAMBDA_TASK_ROOT
  ? path.join(process.env.LAMBDA_TASK_ROOT, 'views')
  : path.join(__dirname, 'views');
app.set('views', viewsDir);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'doneche-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// ---------- Repository functions (Supabase-backed) ----------
async function findUserByEmail(email) {
  if (!useSupabase) return req_local_findUserByEmail(email);
  const { data } = await db.from('users').select('*').eq('email', email).maybeSingle();
  return data;
}
async function findUserById(id) {
  if (!useSupabase) return req_local_findUserById(id);
  const { data } = await db.from('users').select('*').eq('id', id).maybeSingle();
  return data;
}
async function createUser(user) {
  if (!useSupabase) return req_local_createUser(user);
  const { data } = await db
    .from('users')
    .insert({
      name: user.name,
      email: user.email,
      password_hash: user.password,
      plan: 'free',
      referred_by: user.referredBy || null
    })
    .select()
    .single();
  return data;
}
async function setUserPlan(id, plan) {
  if (!useSupabase) return req_local_setUserPlan(id, plan);
  await db.from('users').update({ plan }).eq('id', id);
}

// ---------- Profile / Settings helpers ----------
async function updateUserProfile(id, profile) {
  const payload = {
    professional_title: profile.professionalTitle || null,
    professional_summary: profile.professionalSummary || null,
    skills: profile.skills || null,
    experience_years: profile.experienceYears || null
  };
  if (!useSupabase) return req_local_updateUserProfile(id, payload);
  await db.from('users').update(payload).eq('id', id);
}

async function updateUserTheme(id, theme) {
  if (!useSupabase) return req_local_updateUserTheme(id, theme);
  await db.from('users').update({ theme_preference: theme }).eq('id', id);
}

// ---------- Resume storage + curated Job matching ----------
async function saveUserResume(id, { filename, text }) {
  const payload = {
    resume_filename: filename || null,
    resume_text: text || null,
    resume_uploaded_at: new Date().toISOString()
  };
  if (!useSupabase) return req_local_saveUserResume(id, payload);
  await db.from('users').update(payload).eq('id', id);
}

async function listJobs() {
  if (!useSupabase) return req_local_listJobs();
  const { data } = await db.from('jobs').select('*').order('created_at', { ascending: false });
  return data || [];
}

async function getJob(id) {
  if (!useSupabase) return req_local_getJob(id);
  const { data } = await db.from('jobs').select('*').eq('id', id).maybeSingle();
  return data;
}

async function hasAppliedToJob(userId, jobId) {
  if (!useSupabase) return req_local_hasAppliedToJob(userId, jobId);
  const { data } = await db
    .from('job_applications')
    .select('id')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .maybeSingle();
  return !!data;
}

async function recordJobApplication(userId, jobId) {
  if (!useSupabase) return req_local_recordJobApplication(userId, jobId);
  await db.from('job_applications').upsert(
    { user_id: userId, job_id: jobId },
    { onConflict: 'user_id,job_id' }
  );
}

async function listAppliedJobIds(userId) {
  if (!useSupabase) return req_local_listAppliedJobIds(userId);
  const { data } = await db.from('job_applications').select('job_id').eq('user_id', userId);
  return (data || []).map((r) => r.job_id);
}

// Tokenize a comma/whitespace separated skills/keywords string into a
// normalized set of lowercase tokens for keyword-overlap matching.
function tokenizeKeywords(text) {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

// Extract a broader bag of words from free-form resume text (for matching
// against job skill keywords that may appear inline in the resume prose,
// not just in a dedicated "skills" line).
function tokenizeFreeText(text) {
  if (!text) return new Set();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s+.#-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

// Compute a simple match score (0-100) between a user's resume/profile
// strengths and a job's required skills, based on keyword overlap.
function computeJobMatchScore(userKeywordSet, job) {
  const jobSkills = tokenizeKeywords(job.skills);
  if (jobSkills.size === 0) return 0;
  let matched = 0;
  const matchedSkills = [];
  jobSkills.forEach((skill) => {
    const skillTokens = skill.split(/\s+/).filter(Boolean);
    const isMatch = skillTokens.every((t) => userKeywordSet.has(t)) || userKeywordSet.has(skill);
    if (isMatch) {
      matched += 1;
      matchedSkills.push(skill);
    }
  });
  const score = Math.round((matched / jobSkills.size) * 100);
  return { score, matchedSkills, totalSkills: jobSkills.size };
}

// Build the combined keyword set representing the user's strengths,
// competencies, skills, experience, and domains — pulled from both the
// structured profile fields and the free-text resume, if available.
function buildUserKeywordSet(user) {
  const combined = new Set();
  tokenizeKeywords(user.skills).forEach((k) => combined.add(k));
  tokenizeFreeText(user.professional_title).forEach((k) => combined.add(k));
  tokenizeFreeText(user.professional_summary).forEach((k) => combined.add(k));
  tokenizeFreeText(user.resume_text).forEach((k) => combined.add(k));
  return combined;
}

async function getCuratedJobMatches(user) {
  const jobs = await listJobs();
  const userKeywords = buildUserKeywordSet(user);
  return jobs
    .map((job) => {
      const { score, matchedSkills, totalSkills } = computeJobMatchScore(userKeywords, job);
      return { ...job, matchScore: score, matchedSkills, totalSkills };
    })
    .sort((a, b) => b.matchScore - a.matchScore);
}


// Extract structured professional profile info (title, summary, skills,
// years of experience) from raw resume text using Claude. Used by the
// "Auto-update from Resume" flow — results are always shown to the user for
// review/confirmation before anything is saved (see /profile/parse-resume +
// /profile POST routes).
async function parseProfileFromResumeText(resumeText) {
  if (!anthropicClient) throw new Error('Anthropic client not configured (ANTHROPIC_API_KEY missing).');
  const response = await anthropicClient.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system:
      'Extract professional profile information from this resume. Return ONLY a valid JSON object ' +
      '(no markdown fences) with these exact keys: professionalTitle (string, e.g. current/most recent job title), ' +
      'professionalSummary (string, 2-3 sentence professional summary), skills (string, comma-separated list of key skills), ' +
      'experienceYears (string, total years of professional experience, e.g. "5"). Always include all keys even if empty string.',
    messages: [{ role: 'user', content: resumeText }]
  });
  const text = response.content && response.content[0] && response.content[0].text;
  return extractJsonFromClaudeText(text);
}


// ---------- Referral / Gamification helpers ----------
async function incrementReferralCount(referrerId, newUserName) {
  if (!referrerId) return;
  if (!useSupabase) return req_local_incrementReferralCount(referrerId, newUserName);
  const referrer = await findUserById(referrerId);
  if (!referrer) return;
  const newCount = (referrer.referral_count || 0) + 1;
  const { error } = await db
    .from('users')
    .update({
      referral_count: newCount,
      pending_referral_toast: true,
      last_referral_name: newUserName || 'A friend'
    })
    .eq('id', referrerId);
  if (error) {
    // Surface referral-column errors loudly instead of failing silently —
    // most commonly caused by migrations/004_add_referrals.sql not having
    // been run against the Supabase database yet (missing referral_count /
    // pending_referral_toast / last_referral_name columns).
    console.error('incrementReferralCount failed (check that migrations/004_add_referrals.sql has been applied to Supabase):', error);
  }
}


function referralTier(count) {
  if (count >= 5) return { title: 'Ghostbuster', badge: '🏆' };
  if (count >= 1) return { title: 'Networker', badge: '🥈' };
  return { title: 'Job Hunter', badge: '🔰' };
}

// Feature unlock thresholds
const REFERRALS_FOR_AI_SIMULATOR = 1;
const REFERRALS_FOR_RESUME_MATCHER = 3;
const REFERRALS_FOR_GHOSTBUSTER = 5;
const BASE_APPLICATION_CAPACITY = 20;
const SLOTS_PER_REFERRAL = 5;

function getReferralGamificationState(user) {
  const count = user.referral_count || 0;
  const tier = referralTier(count);
  return {
    referralCount: count,
    tier,
    aiSimulatorUnlocked: count >= REFERRALS_FOR_AI_SIMULATOR,
    resumeMatcherUnlocked: count >= REFERRALS_FOR_RESUME_MATCHER,
    referralsToNextUnlock:
      count < REFERRALS_FOR_AI_SIMULATOR
        ? REFERRALS_FOR_AI_SIMULATOR - count
        : count < REFERRALS_FOR_RESUME_MATCHER
        ? REFERRALS_FOR_RESUME_MATCHER - count
        : 0,
    capacity: BASE_APPLICATION_CAPACITY + count * SLOTS_PER_REFERRAL,
    referralLink: `${process.env.APP_BASE_URL || ''}/register?ref=${user.id}`
  };
}

async function consumePendingReferralToast(userId) {
  if (!useSupabase) return req_local_consumePendingReferralToast(userId);
  const user = await findUserById(userId);
  if (!user || !user.pending_referral_toast) return null;
  await db.from('users').update({ pending_referral_toast: false }).eq('id', userId);
  return user.last_referral_name || 'A friend';
}

async function listApplications(userId) {
  if (!useSupabase) return req_local_listApplications(userId);
  const { data } = await db
    .from('applications')
    .select('*')
    .eq('user_id', userId)
    .order('applied_date', { ascending: false });
  return (data || []).map(normalizeAppRow);
}
async function createApplication(a) {
  if (!useSupabase) return req_local_createApplication(a);
  const { data } = await db
    .from('applications')
    .insert({
      user_id: a.userId,
      company: a.company,
      role: a.role,
      applied_date: a.appliedDate,
      last_update: a.appliedDate,
      status: 'Applied',
      location: a.location || null,
      ctc_lpa: a.ctcLpa || null,
      job_type: a.jobType || null,
      hr_contact: a.hrContact || null,
      hr_email: a.hrEmail || null,
      notes: a.notes || null
    })
    .select()
    .single();
  return normalizeAppRow(data);
}
async function updateApplicationDetails(id, userId, details) {
  if (!useSupabase) return req_local_updateApplicationDetails(id, userId, details);
  await db
    .from('applications')
    .update({
      location: details.location || null,
      ctc_lpa: details.ctcLpa || null,
      job_type: details.jobType || null,
      hr_contact: details.hrContact || null,
      hr_email: details.hrEmail || null,
      notes: details.notes || null
    })
    .eq('id', id)
    .eq('user_id', userId);
}


async function updateApplicationStatus(id, userId, status) {
  if (!useSupabase) return req_local_updateApplicationStatus(id, userId, status);
  await db
    .from('applications')
    .update({ status, last_update: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
}
async function deleteApplication(id, userId) {
  if (!useSupabase) return req_local_deleteApplication(id, userId);
  await db.from('applications').delete().eq('id', id).eq('user_id', userId);
}
async function getApplication(id, userId) {
  if (!useSupabase) return req_local_getApplication(id, userId);
  const { data } = await db.from('applications').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  return data ? normalizeAppRow(data) : null;
}
async function flagGhostedApplications(userId) {
  if (!useSupabase) return req_local_flagGhostedApplications(userId);
  const cutoff = new Date(Date.now() - GHOST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db
    .from('applications')
    .update({ status: 'Ghosted', ghosted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('status', ['Applied', 'Interviewing'])
    .lte('last_update', cutoff);
}

function normalizeAppRow(row) {
  if (!row) return row;
  return {
    id: row.id,
    userId: row.user_id,
    company: row.company,
    role: row.role,
    appliedDate: row.applied_date,
    lastUpdate: row.last_update,
    status: row.status,
    location: row.location || '',
    ctcLpa: row.ctc_lpa || '',
    jobType: row.job_type || '',
    hrContact: row.hr_contact || '',
    hrEmail: row.hr_email || '',
    notes: row.notes || ''
  };
}



// ---------- Local dev fallback (lowdb) ----------
let localDb;
function ensureLocalDb() {
  if (localDb) return localDb;
  const low = require('lowdb');
  const FileSync = require('lowdb/adapters/FileSync');
  const adapter = new FileSync(path.join(__dirname, 'db.json'));
  localDb = low(adapter);
  localDb.defaults({ users: [], applications: [], feedback: [], waitlist: [], jobs: [], jobApplications: [] }).write();

  // Seed curated jobs for local dev if empty, mirroring migrations/007 seed data.
  if (localDb.get('jobs').size().value() === 0) {
    localDb
      .get('jobs')
      .push(
        {
          id: uuidv4(),
          title: 'Senior Product Manager',
          company: 'Northwind Analytics',
          domain: 'Product Management',
          location: 'Bangalore',
          jobType: 'Hybrid',
          ctcLpa: '28-35',
          skills: 'product strategy, stakeholder management, roadmapping, sql, user research, agile',
          description: 'Own the roadmap for a B2B analytics suite used by 500+ enterprise customers.',
          applyUrl: 'https://example.com/jobs/senior-pm-northwind',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'Product Manager - Growth',
          company: 'Loopline',
          domain: 'Product Management',
          location: 'Remote',
          jobType: 'Remote',
          ctcLpa: '18-24',
          skills: 'growth, a/b testing, sql, analytics, product strategy, experimentation',
          description: 'Drive activation and retention experiments across the funnel.',
          applyUrl: 'https://example.com/jobs/pm-growth-loopline',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'Software Engineer - Backend',
          company: 'Vertex Cloud',
          domain: 'Software Engineering',
          location: 'Pune',
          jobType: 'Hybrid',
          ctcLpa: '15-22',
          skills: 'node.js, postgresql, api design, microservices, aws, docker',
          description: 'Build and scale backend services for a fintech platform.',
          applyUrl: 'https://example.com/jobs/backend-vertex',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'Full Stack Developer',
          company: 'Brightpath',
          domain: 'Software Engineering',
          location: 'Remote',
          jobType: 'Remote',
          ctcLpa: '12-18',
          skills: 'javascript, react, node.js, express, mongodb, rest api',
          description: 'Ship features end-to-end for a fast-growing HR tech startup.',
          applyUrl: 'https://example.com/jobs/fullstack-brightpath',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'Data Analyst',
          company: 'Marketwise',
          domain: 'Data & Analytics',
          location: 'Mumbai',
          jobType: 'WFO',
          ctcLpa: '8-12',
          skills: 'sql, excel, tableau, python, data visualization, statistics',
          description: 'Turn raw transaction data into actionable business insights.',
          applyUrl: 'https://example.com/jobs/data-analyst-marketwise',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'HR Business Partner',
          company: 'Solace HR',
          domain: 'Human Resources',
          location: 'Delhi',
          jobType: 'WFO',
          ctcLpa: '14-20',
          skills: 'stakeholder management, employee relations, hr policy, performance management, organizational effectiveness',
          description: 'Partner with leadership to drive org design and talent strategy.',
          applyUrl: 'https://example.com/jobs/hrbp-solace',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'Marketing Manager',
          company: 'Fable & Co',
          domain: 'Marketing',
          location: 'Bangalore',
          jobType: 'Hybrid',
          ctcLpa: '16-22',
          skills: 'content strategy, seo, campaign management, brand marketing, analytics',
          description: 'Lead brand campaigns across digital channels for a D2C label.',
          applyUrl: 'https://example.com/jobs/marketing-mgr-fable',
          createdAt: new Date().toISOString()
        },
        {
          id: uuidv4(),
          title: 'UX Designer',
          company: 'Northwind Analytics',
          domain: 'Design',
          location: 'Remote',
          jobType: 'Remote',
          ctcLpa: '14-20',
          skills: 'figma, user research, prototyping, interaction design, design systems',
          description: 'Design intuitive workflows for enterprise analytics dashboards.',
          applyUrl: 'https://example.com/jobs/ux-designer-northwind',
          createdAt: new Date().toISOString()
        }
      )
      .write();
  }

  return localDb;
}

function req_local_findUserByEmail(email) {

  return ensureLocalDb().get('users').find({ email }).value();
}
function req_local_findUserById(id) {
  return ensureLocalDb().get('users').find({ id }).value();
}
function req_local_createUser(user) {
  const record = {
    id: uuidv4(),
    name: user.name,
    email: user.email,
    password: user.password,
    plan: 'free',
    createdAt: new Date().toISOString()
  };
  ensureLocalDb().get('users').push(record).write();
  return record;
}
function req_local_setUserPlan(id, plan) {
  ensureLocalDb().get('users').find({ id }).assign({ plan }).write();
}
function req_local_updateUserProfile(id, payload) {
  ensureLocalDb()
    .get('users')
    .find({ id })
    .assign({
      professional_title: payload.professional_title,
      professional_summary: payload.professional_summary,
      skills: payload.skills,
      experience_years: payload.experience_years
    })
    .write();
}
function req_local_updateUserTheme(id, theme) {
  ensureLocalDb().get('users').find({ id }).assign({ theme_preference: theme }).write();
}

function req_local_saveUserResume(id, payload) {
  ensureLocalDb()
    .get('users')
    .find({ id })
    .assign({
      resume_filename: payload.resume_filename,
      resume_text: payload.resume_text,
      resume_uploaded_at: payload.resume_uploaded_at
    })
    .write();
}
function req_local_listJobs() {
  return ensureLocalDb().get('jobs').value();
}
function req_local_getJob(id) {
  return ensureLocalDb().get('jobs').find({ id }).value();
}
function req_local_hasAppliedToJob(userId, jobId) {
  return !!ensureLocalDb().get('jobApplications').find({ userId, jobId }).value();
}
function req_local_recordJobApplication(userId, jobId) {
  if (req_local_hasAppliedToJob(userId, jobId)) return;
  ensureLocalDb()
    .get('jobApplications')
    .push({ id: uuidv4(), userId, jobId, appliedAt: new Date().toISOString() })
    .write();
}
function req_local_listAppliedJobIds(userId) {
  return ensureLocalDb().get('jobApplications').filter({ userId }).value().map((r) => r.jobId);
}


function req_local_incrementReferralCount(referrerId, newUserName) {
  const referrer = ensureLocalDb().get('users').find({ id: referrerId }).value();
  if (!referrer) return;
  const newCount = (referrer.referral_count || 0) + 1;
  ensureLocalDb()
    .get('users')
    .find({ id: referrerId })
    .assign({
      referral_count: newCount,
      pending_referral_toast: true,
      last_referral_name: newUserName || 'A friend'
    })
    .write();
}
function req_local_consumePendingReferralToast(userId) {
  const user = ensureLocalDb().get('users').find({ id: userId }).value();
  if (!user || !user.pending_referral_toast) return null;
  ensureLocalDb().get('users').find({ id: userId }).assign({ pending_referral_toast: false }).write();
  return user.last_referral_name || 'A friend';
}

function req_local_listApplications(userId) {
  return ensureLocalDb()
    .get('applications')
    .filter({ userId })
    .orderBy(['appliedDate'], ['desc'])
    .value();
}
function req_local_createApplication(a) {
  const record = {
    id: uuidv4(),
    userId: a.userId,
    company: a.company,
    role: a.role,
    appliedDate: a.appliedDate,
    lastUpdate: a.appliedDate,
    status: 'Applied',
    createdAt: new Date().toISOString(),
    location: a.location || '',
    ctcLpa: a.ctcLpa || '',
    jobType: a.jobType || '',
    hrContact: a.hrContact || '',
    hrEmail: a.hrEmail || '',
    notes: a.notes || ''
  };
  ensureLocalDb().get('applications').push(record).write();
  return record;
}
function req_local_updateApplicationDetails(id, userId, details) {
  ensureLocalDb()
    .get('applications')
    .find({ id, userId })
    .assign({
      location: details.location || '',
      ctcLpa: details.ctcLpa || '',
      jobType: details.jobType || '',
      hrContact: details.hrContact || '',
      hrEmail: details.hrEmail || '',
      notes: details.notes || ''
    })
    .write();
}


function req_local_updateApplicationStatus(id, userId, status) {
  ensureLocalDb()
    .get('applications')
    .find({ id, userId })
    .assign({ status, lastUpdate: new Date().toISOString() })
    .write();
}
function req_local_deleteApplication(id, userId) {
  ensureLocalDb().get('applications').remove({ id, userId }).write();
}
function req_local_getApplication(id, userId) {
  return ensureLocalDb().get('applications').find({ id, userId }).value();
}
function req_local_flagGhostedApplications(userId) {
  const apps = ensureLocalDb().get('applications').filter({ userId }).value();
  apps.forEach((a) => {
    if ((a.status === 'Applied' || a.status === 'Interviewing') && daysSince(a.lastUpdate) >= GHOST_DAYS) {
      ensureLocalDb()
        .get('applications')
        .find({ id: a.id })
        .assign({ status: 'Ghosted', ghostedAt: new Date().toISOString() })
        .write();
    }
  });
}

// ---------- Auth Routes ----------
app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/register', (req, res) => res.render('register', { error: null, ref: req.query.ref || '' }));

app.post('/register', authLimiter, async (req, res) => {

  const { name, email, password, acceptTerms, ref } = req.body;
  if (!name || !email || !password) {
    return res.render('register', { error: 'All fields are required.', ref: ref || '' });
  }
  if (password.length < 6) {
    return res.render('register', { error: 'Password must be at least 6 characters.', ref: ref || '' });
  }

  if (!acceptTerms) {
    return res.render('register', { error: 'You must accept the Terms and Conditions and Privacy Policy to sign up.', ref: ref || '' });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return res.render('register', { error: 'Email already registered.', ref: ref || '' });
  }
  const hash = await bcrypt.hash(password, 10);

  // Referral tracking: validate referrer exists before attaching
  let referredBy = null;
  if (ref) {
    const referrer = await findUserById(ref);
    if (referrer) referredBy = referrer.id;
  }

  const user = await createUser({ name, email, password: hash, referredBy });
  if (referredBy) {
    await incrementReferralCount(referredBy, name);
  }
  req.session.userId = user.id;
  res.redirect('/dashboard');
});


app.get('/login', (req, res) =>
  res.render('login', {
    error: null,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  })
);


app.post('/login', authLimiter, async (req, res) => {

  const { email, password } = req.body;
  const user = await findUserByEmail(email);
  if (!user) return res.render('login', { error: 'Invalid credentials.' });
  const hash = user.password || user.password_hash;
  const match = await bcrypt.compare(password, hash);
  if (!match) return res.render('login', { error: 'Invalid credentials.' });
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Dashboard / Kanban ----------
app.get('/dashboard', requireAuth, async (req, res) => {
  await flagGhostedApplications(req.session.userId);
  const user = await findUserById(req.session.userId);
  const apps = await listApplications(req.session.userId);

  const columns = {
    Applied: apps.filter((a) => a.status === 'Applied'),
    Interviewing: apps.filter((a) => a.status === 'Interviewing'),
    Ghosted: apps.filter((a) => a.status === 'Ghosted'),
    Rejected: apps.filter((a) => a.status === 'Rejected'),
    Offered: apps.filter((a) => a.status === 'Offered')
  };

  const gamification = getReferralGamificationState(user);
  const freeLimit = user.plan === 'paid' ? Infinity : gamification.capacity;
  const atLimit = user.plan === 'free' && apps.length >= freeLimit;

  // "Ghostbuster" social reward: consume any pending referral toast (one-time reveal)
  const referralToastName = await consumePendingReferralToast(user.id);

  res.render('dashboard', {
    user,
    columns,
    atLimit,
    freeLimit,
    appsCount: apps.length,
    gamification,
    referralToastName
  });
});

app.post('/applications', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  const apps = await listApplications(user.id);
  const gamification = getReferralGamificationState(user);
  const capacity = user.plan === 'paid' ? Infinity : gamification.capacity;
  if (user.plan === 'free' && apps.length >= capacity) {
    return res.status(403).redirect('/dashboard?limit=1');
  }

  const { company, role, appliedDate, location, ctcLpa, jobType, hrContact, hrEmail, notes } = req.body;
  await createApplication({
    userId: user.id,
    company,
    role,
    appliedDate: appliedDate || new Date().toISOString(),
    location,
    ctcLpa,
    jobType,
    hrContact,
    hrEmail,
    notes
  });
  res.redirect('/dashboard');
});


// Fetch a single application's details as JSON (used by the card detail modal)
app.get('/applications/:id', requireAuth, async (req, res) => {
  const application = await getApplication(req.params.id, req.session.userId);
  if (!application) return res.status(404).json({ error: 'Not found' });
  res.json(application);
});

// Update optional metadata fields (location, CTC, job type, HR contact, notes)
app.post('/applications/:id/details', requireAuth, async (req, res) => {
  const { location, ctcLpa, jobType, hrContact, hrEmail, notes } = req.body;
  await updateApplicationDetails(req.params.id, req.session.userId, { location, ctcLpa, jobType, hrContact, hrEmail, notes });
  res.redirect('/dashboard');
});



app.post('/applications/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Applied', 'Interviewing', 'Ghosted', 'Rejected', 'Offered'];
  if (!validStatuses.includes(status)) return res.redirect('/dashboard');
  await updateApplicationStatus(req.params.id, req.session.userId, status);
  res.redirect('/dashboard');
});

app.post('/applications/:id/delete', requireAuth, async (req, res) => {
  await deleteApplication(req.params.id, req.session.userId);
  res.redirect('/dashboard');
});

// Follow-up email generator (free feature, part of Ghost Alert hook)
app.get('/applications/:id/followup', requireAuth, async (req, res) => {
  const application = await getApplication(req.params.id, req.session.userId);
  if (!application) return res.redirect('/dashboard');
  const user = await findUserById(req.session.userId);
  res.render('followup', { application, text: followUpTemplate(application), user });
});


// ---------- Phase 1 (paywalled): ATS Matcher ----------
app.get('/ats-matcher', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  res.render('ats-matcher', { user, result: null });
});

app.post('/ats-matcher', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  const gamification = getReferralGamificationState(user);
  if (user.plan !== 'paid' && !gamification.resumeMatcherUnlocked) {
    return res.redirect('/pricing?upgrade=ats');
  }

  const { jobDescription, resume } = req.body;
  const jdWords = new Set(
    jobDescription.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4)
  );
  const resumeWords = new Set(
    resume.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4)
  );
  const gaps = [...jdWords].filter((w) => !resumeWords.has(w)).slice(0, 3);
  res.render('ats-matcher', { user, result: gaps });
});

// ---------- Pricing / Upgrade ----------
app.get('/pricing', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  res.render('pricing', { user, upgrade: req.query.upgrade });
});

app.post('/upgrade', requireAuth, async (req, res) => {
  // Placeholder upgrade path. Wire real Razorpay/Stripe checkout here.
  await setUserPlan(req.session.userId, 'paid');
  res.redirect('/dashboard');
});

// ---------- Feedback / Bug reports ----------
app.post('/feedback', requireAuth, async (req, res) => {
  const { feedbackType, message } = req.body;
  const validTypes = ['Bug', 'Feature Request', 'General'];
  if (!validTypes.includes(feedbackType) || !message || !message.trim()) {
    return res.redirect('/dashboard?feedback=error');
  }
  if (useSupabase) {
    await db.from('feedback').insert({
      user_id: req.session.userId,
      feedback_type: feedbackType,
      message: message.trim()
    });
  } else {
    ensureLocalDb()
      .get('feedback')
      .push({
        id: uuidv4(),
        userId: req.session.userId,
        feedbackType,
        message: message.trim(),
        createdAt: new Date().toISOString()
      })
      .write();
  }

  // Fire-and-forget email alert; failures must never break the feedback flow.
  const user = await findUserById(req.session.userId);
  const userIdentifier = (user && (user.email || user.name)) || req.session.userId;
  await sendFeedbackAlertEmail({
    userIdentifier,
    feedbackType,
    message: message.trim()
  });

  res.redirect('/dashboard?feedback=success');
});


// ---------- Profile: professional info (manual entry + resume auto-fill w/ confirmation) ----------
app.get('/profile', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  res.render('profile', { user, saved: req.query.saved === '1' });
});

app.post('/profile', requireAuth, async (req, res) => {
  const { professionalTitle, professionalSummary, skills, experienceYears } = req.body;
  await updateUserProfile(req.session.userId, { professionalTitle, professionalSummary, skills, experienceYears });
  res.redirect('/profile?saved=1');
});

// Parse an uploaded resume (PDF) and return extracted profile fields as JSON.
// The frontend shows these to the user for review; nothing is saved here —
// saving only happens when the user confirms via the POST /profile form above.
app.post('/api/parse-resume', requireAuth, apiLimiter, async (req, res) => {
  try {
    const { pdf } = req.body; // base64-encoded PDF (data URL or raw base64)
    if (!pdf) return res.status(400).json({ error: 'Missing resume PDF data.' });

    const base64Data = pdf.includes(',') ? pdf.split(',')[1] : pdf;
    const buffer = Buffer.from(base64Data, 'base64');

    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    let pdfTextResult;
    try {
      pdfTextResult = await parser.getText();
    } finally {
      await parser.destroy();
    }
    const extractedText = (pdfTextResult.text || '').trim();
    if (!extractedText) {
      return res.status(422).json({ error: 'Could not extract any text from the resume.' });
    }

    const parsed = await parseProfileFromResumeText(extractedText);
    if (!parsed) {
      return res.status(422).json({ error: 'Could not extract profile details from the resume.' });
    }
    res.json({
      professionalTitle: parsed.professionalTitle || '',
      professionalSummary: parsed.professionalSummary || '',
      skills: parsed.skills || '',
      experienceYears: parsed.experienceYears || ''
    });
  } catch (err) {
    console.error('parse-resume error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse resume.' });
  }
});

// ---------- Resume upload (PDF/DOCX/MD) -> curated Job matches ----------
// Extracts plain text from the uploaded resume file and saves it to the
// user's profile, then computes curated job matches based on keyword
// overlap between the resume + profile fields and each job's required
// skills. No LLM call needed for the matching itself (fast + free).
app.post('/api/upload-resume', requireAuth, apiLimiter, async (req, res) => {
  try {
    const { file, filename } = req.body; // base64 (data URL or raw) + original filename
    if (!file || !filename) return res.status(400).json({ error: 'Missing resume file or filename.' });

    const ext = (filename.split('.').pop() || '').toLowerCase();
    const base64Data = file.includes(',') ? file.split(',')[1] : file;
    const buffer = Buffer.from(base64Data, 'base64');

    let extractedText = '';

    if (ext === 'pdf') {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        extractedText = (result.text || '').trim();
      } finally {
        await parser.destroy();
      }
    } else if (ext === 'docx' || ext === 'doc') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      extractedText = (result.value || '').trim();
    } else if (ext === 'md' || ext === 'txt') {
      extractedText = buffer.toString('utf-8').trim();
    } else {
      return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF, Word (.docx), or Markdown (.md) file.' });
    }

    if (!extractedText) {
      return res.status(422).json({ error: 'Could not extract any text from the uploaded resume.' });
    }

    await saveUserResume(req.session.userId, { filename, text: extractedText });

    const user = await findUserById(req.session.userId);
    const matches = await getCuratedJobMatches(user);

    res.json({
      success: true,
      filename,
      topMatches: matches.slice(0, 5).map((m) => ({
        id: m.id,
        title: m.title,
        company: m.company,
        matchScore: m.matchScore
      }))
    });
  } catch (err) {
    console.error('upload-resume error:', err);
    res.status(500).json({ error: err.message || 'Failed to process resume.' });
  }
});

// ---------- Curated Jobs: view matches + apply in-app ----------
app.get('/jobs', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  const matches = await getCuratedJobMatches(user);
  const appliedJobIds = new Set(await listAppliedJobIds(user.id));
  const jobsWithStatus = matches.map((j) => ({ ...j, alreadyApplied: appliedJobIds.has(j.id) }));
  res.render('jobs', { user, jobs: jobsWithStatus, hasResume: !!(user.resume_text || user.skills) });
});

app.get('/jobs/:id', requireAuth, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.redirect('/jobs');
  const user = await findUserById(req.session.userId);
  const userKeywords = buildUserKeywordSet(user);
  const { score, matchedSkills, totalSkills } = computeJobMatchScore(userKeywords, job);
  const alreadyApplied = await hasAppliedToJob(user.id, job.id);
  res.render('job-detail', {
    user,
    job: { ...job, matchScore: score, matchedSkills, totalSkills },
    alreadyApplied,
    applied: req.query.applied === '1'
  });
});

app.post('/jobs/:id/apply', requireAuth, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.redirect('/jobs');
  await recordJobApplication(req.session.userId, job.id);

  // Also drop it into the main Kanban tracker as an "Applied" card so the
  // user can follow its status (and get ghost-flagged) like any other app.
  await createApplication({
    userId: req.session.userId,
    company: job.company,
    role: job.title,
    appliedDate: new Date().toISOString(),
    location: job.location || (job.locationCity || ''),
    ctcLpa: job.ctc_lpa || job.ctcLpa || '',
    jobType: job.job_type || job.jobType || '',
    notes: 'Applied via doneche curated Jobs'
  });

  res.redirect(`/jobs/${job.id}?applied=1`);
});

// ---------- Settings & Preferences (theme toggle) ----------

app.get('/settings', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  res.render('settings', { user, saved: req.query.saved === '1' });
});

app.post('/settings/theme', requireAuth, async (req, res) => {
  const { theme } = req.body;
  const validThemes = ['light', 'dark'];
  if (validThemes.includes(theme)) {
    await updateUserTheme(req.session.userId, theme);
  }
  // Support both regular form submits (redirect) and fetch()-based toggles (JSON)
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({ success: true, theme });
  }
  res.redirect('/settings?saved=1');
});

// ---------- Help / Documentation ----------
app.get('/help', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  res.render('help', { user });
});

// ---------- FAQ ----------
app.get('/faq', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  res.render('faq', { user });
});

// ---------- Legal pages (Terms & Privacy) ----------

app.get('/terms', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  res.render('terms', { user });
});

app.get('/privacy', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  res.render('privacy', { user });
});

// ---------- What's New ----------
app.get('/whats-new', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  res.render('whats-new', { user });
});

// ---------- Coming Soon: Job Matchmaking Waitlist ----------
app.get('/coming-soon', async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  res.render('coming-soon', { user, error: null, success: false });
});

app.post('/coming-soon', authLimiter, async (req, res) => {
  const user = req.session.userId ? await findUserById(req.session.userId) : null;
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.render('coming-soon', { user, error: 'Please enter a valid email address.', success: false });
  }
  const trimmedEmail = email.trim().toLowerCase();

  try {
    if (useSupabase) {
      await db.from('waitlist').upsert(
        {
          email: trimmedEmail,
          user_id: user ? user.id : null,
          source: 'coming-soon-page'
        },
        { onConflict: 'email' }
      );
    } else {
      const existing = ensureLocalDb().get('waitlist').find({ email: trimmedEmail }).value();
      if (!existing) {
        ensureLocalDb()
          .get('waitlist')
          .push({
            id: uuidv4(),
            email: trimmedEmail,
            userId: user ? user.id : null,
            source: 'coming-soon-page',
            createdAt: new Date().toISOString()
          })
          .write();
      }
    }
    res.render('coming-soon', { user, error: null, success: true });
  } catch (err) {
    console.error('coming-soon waitlist signup error:', err);
    res.render('coming-soon', { user, error: 'Something went wrong. Please try again.', success: false });
  }
});



// ---------- Magic Upload: Screenshot Parsing (Claude) ----------

app.post('/api/parse-screenshot', requireAuth, apiLimiter, async (req, res) => {

  try {
    const { image, mediaType } = req.body;
    if (!image) return res.status(400).json({ error: 'Missing image data.' });

    // Strip data URL prefix if present (e.g. "data:image/png;base64,....")
    const base64Data = image.includes(',') ? image.split(',')[1] : image;
    const detectedType =
      mediaType || (image.startsWith('data:') ? image.substring(5, image.indexOf(';')) : 'image/png');

    const parsed = await parseScreenshotWithClaude(base64Data, detectedType);
    if (!parsed) {
      return res.status(422).json({ error: 'Could not extract company/role from the screenshot.' });
    }
    res.json({
      company: parsed.company || '',
      role: parsed.role || '',
      appliedDate: parsed.appliedDate || '',
      location: parsed.location || '',
      ctcLpa: parsed.ctcLpa || '',
      jobType: parsed.jobType || '',
      hrContact: parsed.hrContact || '',
      hrEmail: parsed.hrEmail || ''
    });
  } catch (err) {
    console.error('parse-screenshot error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse screenshot.' });
  }
});


// ---------- Magic Upload: PDF Parsing (Claude) ----------
app.post('/api/parse-pdf', requireAuth, apiLimiter, async (req, res) => {

  try {
    const { pdf } = req.body; // base64-encoded PDF (data URL or raw base64)
    if (!pdf) return res.status(400).json({ error: 'Missing PDF data.' });

    const base64Data = pdf.includes(',') ? pdf.split(',')[1] : pdf;
    const buffer = Buffer.from(base64Data, 'base64');

    // pdf-parse v2 API: use the PDFParse class instead of the old v1 function export.
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    let pdfTextResult;
    try {
      pdfTextResult = await parser.getText();
    } finally {
      await parser.destroy();
    }
    const extractedText = (pdfTextResult.text || '').trim();


    if (!extractedText) {
      return res.status(422).json({ error: 'Could not extract any text from the PDF.' });
    }

    const parsed = await parseTextWithClaude(extractedText);
    if (!parsed) {
      return res.status(422).json({ error: 'Could not extract company/role from the PDF content.' });
    }
    res.json({
      company: parsed.company || '',
      role: parsed.role || '',
      appliedDate: parsed.appliedDate || '',
      location: parsed.location || '',
      ctcLpa: parsed.ctcLpa || '',
      jobType: parsed.jobType || '',
      hrContact: parsed.hrContact || '',
      hrEmail: parsed.hrEmail || ''
    });
  } catch (err) {
    console.error('parse-pdf error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse PDF.' });
  }
});


// ---------- Core Loop Fallback: Inbound Email Webhook ----------

app.post('/api/inbound-email', apiLimiter, async (req, res) => {

  try {
    const { subject, text, from } = req.body;
    if (!from || !text) {
      return res.status(400).json({ error: 'Missing required fields: from and text are required.' });
    }

    // Extract a clean email address from the "from" field (handles "Name <email>" format)
    const fromMatch = from.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const fromEmail = fromMatch ? fromMatch[0] : from;

    const user = await findUserByEmail(fromEmail);
    if (!user) {
      return res.status(404).json({ error: 'No matching user found for sender email.' });
    }

    const parsed = await parseTextWithClaude(text);
    if (!parsed || !parsed.company || !parsed.role) {
      return res.status(422).json({ error: 'Could not extract company/role from the email body.' });
    }


    await createApplication({
      userId: user.id,
      company: parsed.company,
      role: parsed.role,
      appliedDate: new Date().toISOString()
    });

    res.json({ success: true, company: parsed.company, role: parsed.role });
  } catch (err) {
    console.error('inbound-email error:', err);
    res.status(500).json({ error: err.message || 'Failed to process inbound email.' });
  }
});

// ---------- Health check (for canary monitoring) ----------


app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    datastore: useSupabase ? 'supabase' : 'local-lowdb',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
