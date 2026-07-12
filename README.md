# GhostTracker AI — Phase 0 MVP

Job application tracker that auto-flags when a company has gone silent for 7+ days ("Ghosted") and gives you a one-click follow-up email.

## Features (Phase 0 — free)
- Email/password auth (bcrypt + sessions)
- Kanban board: Applied → Interviewing → Ghosted → Rejected → Offered
- Auto Ghost Alert: any card in Applied/Interviewing for 7+ days auto-flips to Ghosted
- One-click follow-up email generator (template-based, no external AI call — zero API cost)
- Free tier capped at 10 tracked applications

## Features (Phase 1 — paid, ₹399/mo)
- Unlimited applications
- ATS Keyword Matcher (paste JD + resume → top missing keywords)

## Run locally
```bash
cd ghosttracker
npm install
cp .env.example .env    # edit SESSION_SECRET
npm start
```
App runs at http://localhost:3000. A local `db.json` file (gitignored) is used as the datastore via lowdb — fine for the first 6-20 users; migrate to Postgres/Mongo once traction is proven.

## Deploy (fastest options given your existing toolchain)
Given your existing product URLs use **hercules.app**, **bolt.host**, **vercel**, and you already have a live domain pattern like `xyz.onhercules.app` / `xyz.ruvab.it.com` — pick ONE:

1. **Render.com / Railway** (recommended for this Express+session app): connect this repo, set `SESSION_SECRET` env var, deploy. Free tier works for MVP validation.
2. **Vercel**: works but sessions/lowdb file writes don't persist well on serverless — only use if you swap lowdb for a hosted DB (e.g. Supabase/Mongo Atlas) first.
3. **hercules.app / bolt.host** (your usual flow): push this codebase through your normal vibe-coding deploy pipeline, same as your other `onhercules.app` products.

**Suggested subdomain**: `ghosttracker.<yourdomain>` or `ghosttracker.onhercules.app`, matching your existing naming convention.

## Health check
`GET /health` → `{status:"ok", uptime, timestamp}` — wire this into your `/money-ops` canary monitoring once deployed.

## Next steps (per strategy doc `strategy-2026-07-12-ghosttracker-mvp.md`)
1. Deploy to a public URL.
2. Personally onboard your 6 named warm leads (Dinesh, Sanket, Sonal, Suyog, Amey, Sowjanya) — send link, ask them to add real applications.
3. After 3+ active users for a week, run `/money-quality` (pre-launch QA/security gate) before pushing harder on `/money-outreach` and `/money-social`.
4. Wire real Stripe checkout in `/upgrade` route (currently a placeholder that just flips `plan` to `paid` — fine for manual/Sales-led first payments via UPI/Razorpay link, but automate before scaling past ~10 paid users).
