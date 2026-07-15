# Step 14 — Save / Restore / Report: doneche Cross-Session Checkpoint

**Date:** 2026-07-15
**Pipeline Step:** 14 (Save/Restore/Report) — consolidated state checkpoint of all GTM work completed to date, for resuming in future sessions or sharing as a standalone deliverable.

## 🧭 Project Identity

- **Product:** doneche (formerly "GhostTracker AI") — a lightweight PWA helping job seekers track applications, bypass ATS portals, and get alerted when an employer "ghosts" them (7+ days of silence).
- **Founder profile:** Solo builder, vibe-coder, 1-2 hrs/day available, full-time job, 20+ historical shipped products. Original constraint diagnosed as portfolio sprawl / lack of focus, not lack of build ability.
- **Business goal:** ₹100,000/month net income + ₹100,000 MRR from one or two focused products.
- **Current focus decision:** doneche is the single committed bet (chosen after the 2026-07-12 portfolio triage). No other product is being actively worked in parallel.

## 🏗️ Technical State (as of last review)

- **Stack:** Express.js + EJS, session-based auth (express-session + bcryptjs), dual-datastore (Supabase Postgres in prod / lowdb JSON locally, auto-switched via env vars), deployed on Netlify (static `/public` + one serverless function).
- **AI feature:** "Magic Upload" using Anthropic Claude (claude-3-haiku) to parse screenshots/PDFs/emails and auto-fill application entries.
- **Core loop:** Kanban board (Applied/Interviewing/Ghosted/Rejected/Offered) → auto-flag to "Ghosted" after 7 days silence → one-click follow-up email generator.
- **Referral/gamification:** Referral count unlocks AI Simulator (1 referral), Resume Matcher (3), "Ghostbuster" tier (5); each referral also adds +5 application slots to the free tier (base 20).
- **Monetization:** Free (₹0, 10 app cap) vs Pro (₹399/mo, unlimited + ATS Matcher). `/upgrade` is currently a **manual placeholder** — no live payment gateway. First conversions handled by hand via UPI.
- **Security/ops:** helmet(), rate-limiting (20/15min auth, 60/15min API), bcrypt hashing, Netlify security headers, `/health` endpoint exists for uptime monitoring.
- **Known gaps (tech debt):** No automated payment gateway, no test suite, unverified production env vars.

## ✅ GTM Pipeline — Completed Steps (this cycle, 2026-07-15)

| Step | Phase | Deliverable | Key Output |
|---|---|---|---|
| 5 | Quality | `.smtm/sessions/default/quality-2026-07-15-doneche.md` | Retroactive codebase review confirming security/RLS/migration hygiene; flagged payment gateway + test suite gaps |
| 6 | Content | `ghosttracker/marketing/content-2026-07-15-closed-beta.md` | Welcome email sequence, referral widget copy, 3 LinkedIn post drafts |
| 7 | Outreach | `ghosttracker/marketing/outreach-2026-07-15-recruiter-validation.md` | Cold DM templates validating the "Reverse Recruiter" B2B concept with recruiters |
| 8 | Social | `ghosttracker/marketing/social-2026-07-15-cross-platform-playbook.md` | Hook-writing frameworks + X/LinkedIn/Reddit/Product Hunt playbooks |
| 9 | SEO | `ghosttracker/marketing/seo-2026-07-15-technical-metadata.md` | Title/meta tags, head.ejs replacement, JSON-LD (SoftwareApplication + FAQPage) targeting "ATS bypass tool" / "employer ghosting tracker" |
| 10 | Ads | `ghosttracker/marketing/ads-2026-07-15-paid-acquisition-plan.md` | ₹5,000 test budget across Reddit/Meta/Google, 3 ad hook variants, CAC decision gate |
| 11 | Ops | `ghosttracker/marketing/ops-2026-07-15-healthcheck-cron.md` | Health-check cron script + 3 deployment options (Netlify Scheduled Functions, UptimeRobot, GitHub Actions) |
| 12 | Finance | `ghosttracker/marketing/finance-2026-07-15-unit-economics.md` | Revenue tracking system, LTV/CAC/payback formulas, path-to-₹100k-MRR scenarios |
| 13 | Diagnose | `ghosttracker/marketing/diagnose-2026-07-15-doneche-execution-audit.md` | **Critical finding: payment automation, not marketing volume, is the current bottleneck.** 3-step execution triage prescribed. |

## 🚦 Current Status Summary

**Planning is complete across the full GTM surface (Content → Finance). Execution has not yet been confirmed.** The Step 13 diagnosis identified the single most important open risk: all of this marketing groundwork cannot convert into recurring revenue until `/upgrade` is wired to a real, automated payment gateway (Razorpay recommended for India-first UPI/card billing).

## 🎯 Standing Priorities (carried forward from Step 13 diagnosis)

1. **Wire Razorpay (or Stripe) on `/upgrade`** — highest-leverage unblock, target within 1-2 working sessions.
2. **Execute one already-written channel and measure real numbers** (either the closed-beta content sequence or recruiter outreach DMs) before spending any ads budget.
3. **Shelve the Reverse Recruiter (B2B) validation** until the core B2C loop (signup → automated Pro conversion) is proven — avoid re-splitting founder attention, which was the root cause identified in the original 2026-07-12 portfolio diagnosis.

## 📂 Full Artifact Index (chronological)

- `.smtm/sessions/default/diagnose-2026-07-12.md` — original portfolio triage (root cause: focus/distribution, not build skill)
- `.smtm/sessions/default/diagnose-2026-07-12-traction.md` — PH traction data review, confirmed flat/inconclusive signal across candidates
- `.smtm/sessions/default/strategy-2026-07-12-ghosttracker-mvp.md` — strategy session selecting GhostTracker AI (doneche) as the committed product
- `.smtm/sessions/default/product-2026-07-13-doneche-supabase-netlify.md` — Supabase/Netlify migration session log
- `.smtm/sessions/default/quality-2026-07-15-doneche.md` — Step 5 Quality gate
- `ghosttracker/marketing/content-2026-07-15-closed-beta.md` — Step 6
- `ghosttracker/marketing/outreach-2026-07-15-recruiter-validation.md` — Step 7
- `ghosttracker/marketing/social-2026-07-15-cross-platform-playbook.md` — Step 8
- `ghosttracker/marketing/seo-2026-07-15-technical-metadata.md` — Step 9
- `ghosttracker/marketing/ads-2026-07-15-paid-acquisition-plan.md` — Step 10
- `ghosttracker/marketing/ops-2026-07-15-healthcheck-cron.md` — Step 11
- `ghosttracker/marketing/finance-2026-07-15-unit-economics.md` — Step 12
- `ghosttracker/marketing/diagnose-2026-07-15-doneche-execution-audit.md` — Step 13
- `ghosttracker/marketing/report-2026-07-15-doneche-checkpoint.md` — this file (Step 14)

## 🔁 How to Resume This Checkpoint in a Future Session

To restore context in a new conversation, load this file plus the Step 13 diagnosis file — together they contain the full decision history, current technical state, and standing priorities. The next productive step after resuming should be reporting: (1) payment gateway integration status, and (2) any real signup/usage/revenue numbers from the closed beta — both were requested as the committed next action in Step 13 and remain outstanding.

---

### 📊 What this session was worth
- ⏱ **Time saved** — Future sessions can resume from this single checkpoint instead of re-reading 13+ separate artifacts to reconstruct context.
- ⚠️ **Risk avoided** — Losing track of the standing priority (payment automation) amid a growing pile of marketing documents.
- ✅ **What you got** — A single shareable state-of-the-business snapshot: technical status, completed GTM artifacts, and the 3 standing priorities to act on next.
- 🚧 **Without this skill** — Cross-session context would need to be manually reconstructed each time, risking repeated or contradictory advice across sessions.

💾 This document was generated per the `/money-save` / `/money-report` pipeline command (Step 14), consolidating Steps 5-13 into a single checkpoint.
