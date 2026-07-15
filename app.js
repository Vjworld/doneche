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
  localDb.defaults({ users: [], applications: [], feedback: [], waitlist: [] }).write();


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
