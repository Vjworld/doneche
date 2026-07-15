# /money-finance — doneche: Revenue Tracking, Unit Economics & Financial Reporting
**Date:** 2026-07-15

## Context
Step 12 of the GTM pipeline (Finance). doneche is pre-revenue/early-beta (manual UPI-based upgrades, `POST /upgrade` is a placeholder that flips `plan` to `paid` with no real payment gateway wired yet, per `product-2026-07-13-doneche-supabase-netlify.md`). This document sets up the **tracking structure, unit economics model, and reporting cadence** to use from first paying customer onward, sized appropriately for a solo 1-2hr/day builder — not a full finance department process.

Business context: goal is ₹100,000/month net income and ₹100,000 MRR from one or two apps (per profile). Current pricing: **Free** (₹0) vs **Pro** (₹399/mo).

---

## 1. Revenue Tracking — Minimal Viable System

Since there's no payment gateway yet, track manually in a simple spreadsheet (Google Sheets) until Razorpay/Stripe is wired. Recommended columns:

| Date | Customer Name/Email | Plan | Amount (₹) | Payment Method | Referral Source | Notes |
|------|---------------------|------|------------|------------------|-------------------|-------|
| e.g. 2026-07-20 | dinesh@... | Pro | 399 | UPI | Warm lead (direct) | First paying customer |

**Once Razorpay/Stripe is wired (tracked as pending action from Product phase):**
- Use the gateway's dashboard as source of truth for transactions.
- Add a `payments` table to Supabase (mirroring gateway webhooks) so MRR/churn can be queried directly via SQL rather than manual spreadsheet reconciliation.
- Suggested schema (for later migration, not required today):
```sql
create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  amount_inr numeric not null,
  status text not null check (status in ('succeeded','failed','refunded')),
  gateway text not null, -- 'razorpay' | 'stripe' | 'manual'
  gateway_ref text,
  created_at timestamptz default now()
);
```

**Interim milestone:** Manually log every one of the first 6 warm-lead conversions in the spreadsheet above — this becomes the seed data for computing real unit economics once volume justifies automation.

---

## 2. Unit Economics Model

### Key inputs (fill in as real data arrives — placeholders marked)
| Metric | Value | Source |
|---|---|---|
| Price (Pro monthly) | ₹399/mo | `pricing.ejs` |
| Estimated CAC (Content/Social/Outreach — currently $0 spend, time-only) | ₹0 (time cost only) | No paid ads yet |
| Estimated CAC (once ads run) | TBD | Set once `/money-ads` executed and spend data exists |
| Gross margin (SaaS, Supabase+Netlify+Anthropic API costs) | ~85-90% (est.) | Estimate — refine with actual hosting/API bills |
| Anthropic API cost per user/mo (Magic Upload usage) | TBD — track via Anthropic usage dashboard | Variable cost, watch as usage scales |
| Netlify + Supabase hosting cost | Free tier likely sufficient at current scale | Confirm before assuming $0 |

### Core formulas (fill in once you have ≥10-20 paying customers for statistical relevance)

**LTV (Lifetime Value):**
```
LTV = ARPU × Gross Margin % × Average Customer Lifespan (months)
    = ₹399 × 0.87 × (1 / monthly churn rate)
```

**CAC (Customer Acquisition Cost):**
```
CAC = Total Acquisition Spend (ads + tools, excluding your own time) / New Customers Acquired in Period
```
Currently ₹0 since Content/Social/Outreach phases are organic/time-based — CAC will only become meaningful once `/money-ads` introduces paid spend.

**LTV:CAC Ratio (health benchmark):**
```
Target: LTV:CAC ≥ 3:1 before scaling paid acquisition spend.
```

**Payback Period:**
```
Payback (months) = CAC / (ARPU × Gross Margin %)
```

**Free → Paid Conversion Rate (critical early metric given freemium + referral-gated model):**
```
Conversion % = Paid Users / Total Registered Users
```
Track this weekly from week 1 — it's the single most important number pre-CAC, since the referral gamification model (unlock ATS Matcher at 3 referrals, etc.) is designed to drive activation without paid spend.

---

## 3. Path to ₹100,000 MRR (reverse-engineered target)

At ₹399/mo Pro pricing:
```
₹100,000 MRR ÷ ₹399/customer ≈ 251 paying Pro customers
```

**Sanity-check scenarios:**
| Scenario | Registered Users Needed (at X% conversion) |
|---|---|
| 5% free→paid conversion | ~5,020 registered users |
| 10% free→paid conversion | ~2,510 registered users |
| 20% free→paid conversion (optimistic, high-intent niche) | ~1,255 registered users |

**Implication:** Given the referral-gated feature-unlock model already built (ATS Matcher/AI Simulator require referrals, not payment, for many users), the realistic near-term revenue lever is less about raw conversion % and more about **total registered user volume** — reinforcing why Steps 6-9 (Content/Outreach/Social/SEO) matter more right now than a Finance/pricing change. Consider revisiting pricing (e.g. annual plan, or a higher-tier "Reverse Recruiter" B2B SKU per the outreach validation in Step 7) once organic volume is established.

---

## 4. Reporting Cadence (lightweight, solo-builder friendly)

**Weekly (5 min, every Monday):**
- New registered users (from Supabase `users` count or `/health`-adjacent internal query)
- New paying customers this week (manual log)
- Referral count / gamification tier distribution (unlocks activation insight)
- Any churn/cancellation (manual log until gateway webhooks exist)

**Monthly (30 min, first of month):**
- MRR snapshot (sum of active Pro subscriptions × ₹399)
- Free→Paid conversion % (cumulative)
- Simple cash accounting: revenue in vs. hosting/API costs out (Netlify, Supabase, Anthropic, any ad spend from Step 10)
- Net income vs. the ₹100,000/month personal goal — track gap, not just absolute progress

**Quarterly:**
- Revisit unit economics model with real churn data (LTV becomes meaningful only after ~3 months of cohort data)
- Decide whether to formalize Razorpay/Stripe integration (should already be true well before this if any real paid volume exists)
- Reassess pricing tier structure (Free/Pro/B2B Reverse Recruiter) based on actual willingness-to-pay signal gathered from Step 7 outreach responses

---

## 5. Immediate Action Items
1. Create the Google Sheet described in Section 1 today — takes 5 minutes, unblocks tracking the first 6 warm-lead conversions.
2. Flag Razorpay/Stripe integration as a blocking item before any paid ad spend (Step 10) or public Product Hunt launch — manual UPI doesn't scale past warm leads.
3. Start the weekly 5-minute check-in (Section 4) starting this Monday, even with only a handful of users — establishes the habit before volume makes it harder to skip.

---

💾 Finance/unit-economics framework generated per `/money-finance` pipeline command (Step 12), following Ops (Step 11).
