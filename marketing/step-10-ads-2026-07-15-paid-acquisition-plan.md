# Step 10 — Ads: Paid Acquisition Plan for doneche

**Date:** 2026-07-15
**Pipeline Step:** 10 (Ads) — following Step 9 (SEO) and preceding Step 11 (Ops)/Step 12 (Finance), which were completed out of order.

## Context & Constraints

- Solo founder, 1-2 hrs/day, no dedicated ad budget confirmed yet — this plan assumes a **test budget of ₹3,000-₹5,000 total** before scaling.
- Product is pre-revenue/early-beta (closed beta per Step 6). Paid ads should NOT be turned on until:
  1. Referral/organic/outreach channels (Steps 6-8) have validated basic messaging and conversion.
  2. `/upgrade` has a real payment gateway wired (currently manual UPI placeholder — flagged in Quality review).
- Goal of this phase is **cheap validation of ad hooks**, not scaling spend. Do not treat this as a "run ₹50k/month" plan.

## Recommended Channel Priority (cheapest signal first)

1. **Reddit Ads** (r/jobs, r/recruitinghell, r/cscareerquestions) — audience is emotionally primed for "ghosting" pain point, CPCs typically low (₹15-40), high intent.
2. **Meta Ads (Instagram/Facebook)** — retargeting website visitors from organic/social posts (Step 8) + lookalike from waitlist/beta signups. Good for testing 3-4 ad creative variants cheaply.
3. **Google Search Ads** — only for high-intent long-tail keywords already identified in SEO (Step 9): "employer ghosting tracker", "ATS bypass tool". Low volume but very high intent; good for a small always-on budget (₹500-1000/month) once conversion tracking is confirmed working.
4. **LinkedIn Ads** — expensive (₹200+ CPC), skip until Reverse Recruiter B2B validation (Step 7) shows real recruiter interest and you have a b2b landing page to point to.

## Budget Split for ₹5,000 Test

| Channel | Budget | Goal |
|---|---|---|
| Reddit Ads | ₹2,500 | Validate 3 hook variants, get first 50-100 clicks |
| Meta Ads (retargeting) | ₹1,500 | Re-engage social post viewers, drive signups |
| Google Search (branded/long-tail) | ₹1,000 | Capture existing high-intent search demand |

## Ad Creative — 3 Hook Variants to Test

**Variant A — Pain-first:**
> "Applied to 50 jobs. Heard back from 3. The other 47? Ghosted. doneche tells you the moment a company goes silent — so you can follow up before it's too late."
> CTA: Track your applications free →

**Variant B — Feature-first (Magic Upload):**
> "Stop manually logging job applications. Screenshot the confirmation email, doneche's AI logs it for you in 2 seconds."
> CTA: Try Magic Upload free →

**Variant C — Social proof / community:**
> "Job seekers are tired of the silence. doneche flags any company that goes quiet for 7+ days — so you always know where you stand."
> CTA: Join the closed beta →

## Landing Page Requirements

- All ad traffic should land on `/register` or a dedicated `/beta` page (not homepage) to reduce friction — confirm this route exists or route to `/pricing` if not.
- Ensure UTM parameters are appended to every ad link: `?utm_source=reddit&utm_medium=cpc&utm_campaign=ghost-hook-a` (swap per variant) so results are attributable in the Finance tracking sheet (Step 12).

## Tracking & Attribution

- Reuse the `/health` and referral tracking patterns already in `app.js` — add a lightweight `utm_source`/`utm_campaign` capture on `/register` (store in session or a `signup_source` column) so Finance reporting (Step 12) can tie CAC to actual channel spend, not just self-reported "how did you hear about us."
- Minimum viable tracking: a spreadsheet row per ad variant with spend, clicks, signups, and Pro conversions — cross-reference with the unit economics sheet from Step 12.

## Decision Gate Before Scaling

Do NOT increase ad spend beyond the ₹5,000 test until:
- At least one variant shows a **CAC below ₹150** (per Step 12 unit economics targets).
- Payment gateway is live so Pro conversions can be tracked as real revenue, not manual UPI promises.
- Reddit/Meta creative has been validated against at least 100 clicks per variant (statistical noise floor).

---
💾 This document was generated per the `/money-ads` pipeline command (Step 10), following Step 9 (SEO) and preceding the already-completed Step 11 (Ops)/Step 12 (Finance).
