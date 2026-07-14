# doneche — Phase 0 MVP

*(formerly "GhostTracker AI" — folder name kept as `ghosttracker` for repo continuity)*

Job application tracker for frustrated job seekers. Auto-flags when a company has gone silent for 7+ days ("Ghosted") and gives you a one-click follow-up email.

## Features (Phase 0 — free)
- Email/password auth (bcrypt + sessions)
- Kanban board: Applied → Interviewing → Ghosted → Rejected → Offered
- Auto Ghost Alert: any card in Applied/Interviewing for 7+ days auto-flips to Ghosted
- One-click follow-up email generator (template-based, no external AI call — zero API cost)
- Free tier capped at 10 tracked applications

## Features (Phase 1 — paid, ₹399/mo)
- Unlimited applications
- ATS Keyword Matcher (paste JD + resume → top missing keywords)

## Features — Growth & UX (latest)
- **Referral / Gamification system**: unique invite link per user; 1 referral unlocks the AI Interview Simulator, 3 referrals unlock VIP AI Resume Matcher access, 5 referrals earns the "Ghostbuster" badge. Each referral also grants +5 application storage slots (Capacity Expansion widget).
- **Share App button**: always-visible floating button on the dashboard for quick access to your invite link.
- **Referral toast + confetti**: celebratory notification when a friend joins using your link.
- **Magic Upload**: upload a screenshot or PDF of your application confirmation to auto-fill Company/Role/etc. via Claude AI.
- **Inbound email auto-tracking**: forward application confirmation emails to auto-add them to your board.
- **Shared UI helpers** (`public/ui.js`): global toast notifications, button loading-spinners, and a safety net that surfaces any JS/network error as a toast instead of failing silently.
- **Mobile-friendly**: responsive nav hamburger menu, swipeable Kanban board, stacked forms, and 44px+ touch targets.
- **Account & Security**: Terms & Conditions / Privacy Policy pages, password reset, shared top nav with active-link highlighting and breadcrumb back-links.
- **First-time onboarding tour** (driver.js) highlighting key features for new users.
- **More visible ghost 👻 micro-animation** across the app (nav, login, register).

*Whenever a new feature/enhancement ships, update `views/whats-new.ejs` (public-facing changelog) alongside this README.*


## Architecture
- **App logic**: `app.js` — a single Express app used both locally and in production.
- **Local dev**: `server.js` boots `app.js` with `app.listen()`, using a local `db.json` (lowdb) datastore — zero setup required.
- **Production (Netlify)**: `netlify/functions/app.js` wraps the same `app.js` with `serverless-http`. When `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars are set, the app automatically switches from lowdb to Supabase (Postgres) for all reads/writes — see `schema.sql`.

## Run locally
```bash
cd ghosttracker
npm install
cp .env.example .env    # edit SESSION_SECRET; leave SUPABASE_* blank for local lowdb
npm start
```
App runs at http://localhost:3000.

## Deploy to Netlify + Supabase
1. **Supabase**: create a project, open the SQL editor, paste and run `schema.sql`. Copy your Project URL and `service_role` key (Settings → API).
2. **Netlify**: connect this GitHub repo (main branch). Netlify will read `netlify.toml` automatically:
   - Publishes `public/` as static assets (CSS etc.)
   - Routes all other requests to the bundled Express app via `netlify/functions/app.js`
3. In Netlify → Site settings → Environment variables, set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET`
   - `APP_BASE_URL` — production URL, no trailing slash (**https://doneche.shabdly.online**) — used to build referral invite links
   - `ADSENSE_CLIENT_ID` (optional — see below)

4. Trigger a deploy. Visit `/health` on the live URL to confirm `"datastore":"supabase"`.

## Ghost detection (7-day rule)
Primary check runs on every dashboard load (`flagGhostedApplications` in `app.js`). As a backup/scheduled safety net, `schema.sql` also includes a `flag_ghosted_applications()` Postgres function you can wire to Supabase's pg_cron or a Netlify scheduled function to run daily even if a user never opens the app.

## Monetization / AdSense
- Pricing page (`/pricing`) offers Free vs Pro (₹399/mo). `/upgrade` is currently a manual-flip placeholder — wire Razorpay/Stripe before scaling past your first ~10 paid users.
- **Google AdSense**: exactly ONE verification method is wired — a `<meta name="google-adsense-account">` tag in `views/partials/head.ejs`, driven by the `ADSENSE_CLIENT_ID` env var. Do not add a second verification method (e.g. ads.txt or inline script tag) — that causes ownership conflicts in AdSense.

## Health check
`GET /health` → `{status, datastore, uptime, timestamp}` — wire into `/money-ops` canary monitoring once deployed.

## Next steps (per strategy doc `strategy-2026-07-12-ghosttracker-mvp.md`)
1. Deploy to Netlify + Supabase (above).
2. Personally onboard your 6 named warm leads (Dinesh, Sanket, Sonal, Suyog, Amey, Sowjanya).
3. After 3+ active users for a week, run `/money-quality` (pre-launch QA/security gate) before pushing harder on `/money-outreach` and `/money-social`.
4. Wire real Razorpay/Stripe checkout in `/upgrade` once you have your first willing-to-pay conversation.
