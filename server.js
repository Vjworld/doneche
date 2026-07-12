require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);
db.defaults({ users: [], applications: [] }).write();

const app = express();
const PORT = process.env.PORT || 3000;
const GHOST_DAYS = 7; // days of silence before auto-flag

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'ghosttracker-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
  })
);

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function daysSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function followUpTemplate(app) {
  return `Subject: Following up on my application for ${app.role} at ${app.company}

Hi there,

I hope you're doing well. I wanted to follow up on my application for the ${app.role} position at ${app.company}, submitted on ${new Date(
    app.appliedDate
  ).toLocaleDateString()}. I remain very interested in the opportunity and would love to hear about next steps whenever convenient.

Please let me know if there's any additional information I can provide.

Best regards,
[Your Name]`;
}

// Re-evaluate ghost status for a user's applications
function refreshGhostStatus(userId) {
  const apps = db.get('applications').filter({ userId }).value();
  apps.forEach((a) => {
    if (
      (a.status === 'Applied' || a.status === 'Interviewing') &&
      daysSince(a.lastUpdate) >= GHOST_DAYS
    ) {
      db.get('applications')
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

app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.render('register', { error: 'All fields are required.' });
  }
  const existing = db.get('users').find({ email }).value();
  if (existing) {
    return res.render('register', { error: 'Email already registered.' });
  }
  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    name,
    email,
    password: hash,
    plan: 'free',
    createdAt: new Date().toISOString()
  };
  db.get('users').push(user).write();
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.get('users').find({ email }).value();
  if (!user) return res.render('login', { error: 'Invalid credentials.' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.render('login', { error: 'Invalid credentials.' });
  req.session.userId = user.id;
  res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Dashboard / Kanban ----------
app.get('/dashboard', requireAuth, (req, res) => {
  refreshGhostStatus(req.session.userId);
  const user = db.get('users').find({ id: req.session.userId }).value();
  const apps = db
    .get('applications')
    .filter({ userId: req.session.userId })
    .orderBy(['appliedDate'], ['desc'])
    .value();

  const columns = {
    Applied: apps.filter((a) => a.status === 'Applied'),
    Interviewing: apps.filter((a) => a.status === 'Interviewing'),
    Ghosted: apps.filter((a) => a.status === 'Ghosted'),
    Rejected: apps.filter((a) => a.status === 'Rejected'),
    Offered: apps.filter((a) => a.status === 'Offered')
  };

  const freeLimit = 10;
  const atLimit = user.plan === 'free' && apps.length >= freeLimit;

  res.render('dashboard', { user, columns, atLimit, freeLimit, appsCount: apps.length });
});

app.post('/applications', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.session.userId }).value();
  const currentCount = db.get('applications').filter({ userId: user.id }).size().value();
  if (user.plan === 'free' && currentCount >= 10) {
    return res.status(403).redirect('/dashboard?limit=1');
  }
  const { company, role, appliedDate } = req.body;
  const newApp = {
    id: uuidv4(),
    userId: user.id,
    company,
    role,
    appliedDate: appliedDate || new Date().toISOString(),
    lastUpdate: appliedDate || new Date().toISOString(),
    status: 'Applied',
    createdAt: new Date().toISOString()
  };
  db.get('applications').push(newApp).write();
  res.redirect('/dashboard');
});

app.post('/applications/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['Applied', 'Interviewing', 'Ghosted', 'Rejected', 'Offered'];
  if (!validStatuses.includes(status)) return res.redirect('/dashboard');
  db.get('applications')
    .find({ id: req.params.id, userId: req.session.userId })
    .assign({ status, lastUpdate: new Date().toISOString() })
    .write();
  res.redirect('/dashboard');
});

app.post('/applications/:id/delete', requireAuth, (req, res) => {
  db.get('applications')
    .remove({ id: req.params.id, userId: req.session.userId })
    .write();
  res.redirect('/dashboard');
});

// Follow-up email generator (free feature, part of Ghost Alert hook)
app.get('/applications/:id/followup', requireAuth, (req, res) => {
  const application = db
    .get('applications')
    .find({ id: req.params.id, userId: req.session.userId })
    .value();
  if (!application) return res.redirect('/dashboard');
  res.render('followup', { application, text: followUpTemplate(application) });
});

// ---------- Phase 1 (paywalled): ATS Matcher ----------
app.get('/ats-matcher', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.session.userId }).value();
  res.render('ats-matcher', { user, result: null });
});

app.post('/ats-matcher', requireAuth, (req, res) => {
  const user = db.get('users').find({ id: req.session.userId }).value();
  if (user.plan !== 'paid') {
    return res.redirect('/pricing?upgrade=ats');
  }
  const { jobDescription, resume } = req.body;
  // Simple keyword-gap heuristic (no external AI call needed for MVP)
  const jdWords = new Set(
    jobDescription
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4)
  );
  const resumeWords = new Set(
    resume
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 4)
  );
  const gaps = [...jdWords].filter((w) => !resumeWords.has(w)).slice(0, 3);
  res.render('ats-matcher', { user, result: gaps });
});

// ---------- Pricing / Upgrade (Stripe optional) ----------
app.get('/pricing', requireAuth, (req, res) => {
  res.render('pricing', { user: db.get('users').find({ id: req.session.userId }).value(), upgrade: req.query.upgrade });
});

app.post('/upgrade', requireAuth, (req, res) => {
  // Placeholder upgrade path. Wire real Stripe checkout session here when STRIPE_SECRET_KEY is set.
  db.get('users').find({ id: req.session.userId }).assign({ plan: 'paid' }).write();
  res.redirect('/dashboard');
});

// ---------- Health check (for canary monitoring) ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`GhostTracker AI running on http://localhost:${PORT}`);
});
