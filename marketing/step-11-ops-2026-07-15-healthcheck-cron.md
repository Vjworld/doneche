# /money-ops — doneche: Daily Health-Check Cron Script
**Date:** 2026-07-15

## Context
Step 11 of the GTM pipeline (Ops). Goal: a Node.js script, deployable as a scheduled cron job, that pings the live doneche `/health` endpoint daily to confirm both (a) the frontend/server is responding and (b) the Supabase datastore is healthy — using the existing `/health` route in `app.js` which already returns `{ status, datastore, uptime, timestamp }`.

Since doneche runs on Netlify (serverless, no long-running server to attach a cron to), the recommended deployment is **Netlify Scheduled Functions** (or an external free cron pinger like cron-job.org / UptimeRobot as a lightweight alternative). The script below is written to work as a standalone Node script (runnable via any scheduler: Netlify Scheduled Function, GitHub Actions cron, or a local/VPS crontab).

---

## 1. The Script — `scripts/health-check-cron.js`

```javascript
/**
 * doneche — Daily Health-Check Cron Script
 *
 * Pings the live /health endpoint to confirm:
 *   1. The frontend/server is responding (HTTP 200)
 *   2. The datastore is "supabase" (not silently fallen back to local-lowdb in prod)
 *
 * On failure, sends an alert email via Nodemailer (reuses the same Gmail
 * app-password pattern already used in app.js for feedback alerts).
 *
 * Usage:
 *   node scripts/health-check-cron.js
 *
 * Required env vars:
 *   HEALTH_CHECK_URL   - e.g. https://doneche.shabdly.online/health
 *   ALERT_EMAIL_USER   - Gmail address used to SEND the alert
 *   ALERT_EMAIL_PASS   - Gmail app password
 *   ALERT_EMAIL_TO     - Address to receive alerts (defaults to ALERT_EMAIL_USER)
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL || 'https://doneche.shabdly.online/health';
const ALERT_EMAIL_USER = process.env.ALERT_EMAIL_USER;
const ALERT_EMAIL_PASS = process.env.ALERT_EMAIL_PASS;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO || ALERT_EMAIL_USER;

const REQUEST_TIMEOUT_MS = 10000;

function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

async function sendAlertEmail(subject, bodyText) {
  if (!ALERT_EMAIL_USER || !ALERT_EMAIL_PASS) {
    console.error('[health-check] Alert email not configured (ALERT_EMAIL_USER/ALERT_EMAIL_PASS missing). Skipping email, logging only.');
    return;
  }
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: ALERT_EMAIL_USER, pass: ALERT_EMAIL_PASS }
    });
    await transporter.sendMail({
      from: ALERT_EMAIL_USER,
      to: ALERT_EMAIL_TO,
      subject: `🚨 doneche Health Check: ${subject}`,
      text: bodyText
    });
    console.log('[health-check] Alert email sent.');
  } catch (err) {
    console.error('[health-check] Failed to send alert email:', err.message);
  }
}

async function runHealthCheck() {
  const startedAt = new Date().toISOString();
  console.log(`[health-check] Starting check at ${startedAt} → ${HEALTH_CHECK_URL}`);

  try {
    const res = await fetchWithTimeout(HEALTH_CHECK_URL, REQUEST_TIMEOUT_MS);

    if (!res.ok) {
      const msg = `Health endpoint returned HTTP ${res.status} at ${startedAt}.`;
      console.error(`[health-check] FAIL — ${msg}`);
      await sendAlertEmail('Server not responding correctly', msg);
      process.exitCode = 1;
      return;
    }

    const data = await res.json();
    console.log('[health-check] Response:', JSON.stringify(data));

    // Frontend/server check
    if (data.status !== 'ok') {
      const msg = `Health endpoint returned status="${data.status}" (expected "ok") at ${startedAt}.`;
      console.error(`[health-check] FAIL — ${msg}`);
      await sendAlertEmail('Server status not OK', msg);
      process.exitCode = 1;
      return;
    }

    // Datastore check — expect "supabase" in production. If it silently
    // fell back to "local-lowdb" on a serverless deploy, that's a critical
    // misconfiguration (missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars).
    if (data.datastore !== 'supabase') {
      const msg = `Datastore reported as "${data.datastore}" instead of "supabase" at ${startedAt}. ` +
        `This likely means SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing/misconfigured in the production environment, ` +
        `and the app has silently fallen back to local-lowdb (data will NOT persist correctly on serverless).`;
      console.error(`[health-check] FAIL — ${msg}`);
      await sendAlertEmail('Supabase datastore not active', msg);
      process.exitCode = 1;
      return;
    }

    console.log(`[health-check] PASS — server OK, datastore=supabase, uptime=${data.uptime}s, checked at ${startedAt}.`);
    process.exitCode = 0;
  } catch (err) {
    const msg = `Health check request failed entirely (server may be down or unreachable): ${err.message}`;
    console.error(`[health-check] FAIL — ${msg}`);
    await sendAlertEmail('Server unreachable', msg);
    process.exitCode = 1;
  }
}

runHealthCheck();
```

---

## 2. Deployment Option A (Recommended) — Netlify Scheduled Function

Netlify Scheduled Functions run on a cron schedule natively, no external service needed, and live in the same repo/deploy.

**`netlify/functions/health-check-scheduled.js`:**
```javascript
// Netlify Scheduled Function — runs daily per the schedule in netlify.toml.
// Reuses the same logic as scripts/health-check-cron.js.
const { schedule } = require('@netlify/functions');

async function handler(event) {
  // Inline require to avoid bundling issues; delegates to the shared script logic.
  require('../../scripts/health-check-cron.js');
  return { statusCode: 200, body: 'Health check triggered.' };
}

exports.handler = schedule('@daily', handler);
```

**Add to `netlify.toml`:**
```toml
[functions."health-check-scheduled"]
  schedule = "@daily"
```

**New dependency needed:**
```
npm install @netlify/functions
```

**Env vars to set in Netlify UI (Site settings → Environment variables):**
- `HEALTH_CHECK_URL` = `https://doneche.shabdly.online/health`
- `ALERT_EMAIL_USER` (can reuse existing `EMAIL_USER`)
- `ALERT_EMAIL_PASS` (can reuse existing `EMAIL_APP_PASSWORD`)
- `ALERT_EMAIL_TO` = `vaibhavseluk@gmail.com`

---

## 3. Deployment Option B (Simpler, zero-code) — External Free Uptime Pinger
If you'd rather not manage a scheduled function at all:
- **UptimeRobot** (free tier: 50 monitors, 5-min interval) — add `https://doneche.shabdly.online/health` as an HTTP(s) monitor, set "keyword" alert to look for `"status":"ok"` and `"datastore":"supabase"` in the response body. Configure email/SMS alert on failure.
- **cron-job.org** (free) — schedule a daily GET request to the health endpoint; pair with a webhook-based alert (e.g. via a Zapier/Make webhook to email) if you want the same alerting without writing/maintaining the Node script at all.

This is the lowest-maintenance option for a 1-2hr/day solo builder — recommended as the immediate v1, with the Netlify Scheduled Function as a v2 upgrade once more time is available.

---

## 4. GitHub Actions Alternative (if preferring code-based scheduling outside Netlify)

**`.github/workflows/health-check.yml`:**
```yaml
name: Daily Health Check
on:
  schedule:
    - cron: '0 3 * * *'  # 3:00 AM UTC daily (~8:30 AM IST)
  workflow_dispatch: {}   # allows manual trigger from GitHub Actions tab

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install nodemailer dotenv
      - run: node scripts/health-check-cron.js
        env:
          HEALTH_CHECK_URL: https://doneche.shabdly.online/health
          ALERT_EMAIL_USER: ${{ secrets.ALERT_EMAIL_USER }}
          ALERT_EMAIL_PASS: ${{ secrets.ALERT_EMAIL_PASS }}
          ALERT_EMAIL_TO: ${{ secrets.ALERT_EMAIL_TO }}
```
Secrets configured in GitHub repo → Settings → Secrets and variables → Actions. This is free, requires no Netlify function changes, and keeps the check fully decoupled from the production deploy.

---

## 5. Recommendation
For a solo, time-constrained builder: **start with Option B (UptimeRobot)** today — 5 minutes of setup, zero code to maintain. Add the Node script (Option A or C) later if you want richer, doneche-specific health semantics (e.g. explicitly distinguishing "server down" vs "datastore misconfigured") beyond what a generic uptime monitor's keyword-match can tell you.

---

💾 Ops script generated per `/money-ops` pipeline command (Step 11), following SEO (Step 9).
