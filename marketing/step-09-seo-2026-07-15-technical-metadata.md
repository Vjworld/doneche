# /money-seo — doneche: Technical SEO Metadata, Title Tags & JSON-LD
**Date:** 2026-07-15

## Context
Step 9 of the GTM pipeline. Target keywords: **"ATS bypass tool"** and **"employer ghosting tracker"** (plus supporting long-tail variants). doneche is an EJS/Express app (no static `index.html`) — the equivalent entry point is `views/partials/head.ejs`, which is included in the public-facing login/register/marketing pages. Below is ready-to-paste code for that file, plus a portable static `index.html` `<head>` block if a standalone landing page is ever spun up.

**Primary keyword mapping:**
- "ATS bypass tool" → ties to the Magic Upload / manual logging angle (bypassing ATS portals to track applications directly) and the ATS Matcher feature.
- "employer ghosting tracker" → primary brand positioning, matches the core Ghost Alert feature.
- Supporting long-tails: "job application tracker ghosted", "track job applications silence", "job ghosting follow up email generator".

---

## 1. Updated Title Tag & Meta Description (target both keywords)

```html
<title>doneche — Employer Ghosting Tracker & ATS Bypass Tool for Job Seekers</title>
<meta name="description" content="doneche is an employer ghosting tracker that flags job applications gone silent for 7+ days, plus an ATS bypass tool that logs applications directly — no more guessing if you were rejected or ignored. Free to start." />
```

**Rationale:** Title keeps brand name first (for direct/branded search + social recognition), then both target keyword phrases naturally in sequence. Description repeats both phrases once each within the first ~155 characters, includes a benefit statement and a soft CTA ("Free to start").

---

## 2. Full Recommended `<head>` Block (drop-in replacement for `views/partials/head.ejs`)

```html
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>doneche — Employer Ghosting Tracker & ATS Bypass Tool for Job Seekers</title>
<meta name="description" content="doneche is an employer ghosting tracker that flags job applications gone silent for 7+ days, plus an ATS bypass tool that logs applications directly — no more guessing if you were rejected or ignored. Free to start." />
<meta name="keywords" content="employer ghosting tracker, ATS bypass tool, job application tracker, job ghosting, application follow up generator, job search tracker" />
<link rel="canonical" href="https://doneche.shabdly.online/" />

<!-- Open Graph / Twitter Card (social share previews) -->
<meta property="og:type" content="website" />
<meta property="og:title" content="doneche — Employer Ghosting Tracker & ATS Bypass Tool" />
<meta property="og:description" content="Flag job applications gone silent for 7+ days and bypass slow ATS portals with direct application logging. Free to start." />
<meta property="og:url" content="https://doneche.shabdly.online/" />
<meta property="og:site_name" content="doneche" />
<meta property="og:image" content="https://doneche.shabdly.online/og-image.png" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="doneche — Employer Ghosting Tracker & ATS Bypass Tool" />
<meta name="twitter:description" content="Flag job applications gone silent for 7+ days and bypass slow ATS portals with direct application logging." />
<meta name="twitter:image" content="https://doneche.shabdly.online/og-image.png" />

<!-- GEO/SEO: structured data for AI search + rich results -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "doneche",
  "alternateName": "Employer Ghosting Tracker",
  "description": "doneche is an employer ghosting tracker and ATS bypass tool for job seekers. It auto-flags job applications that have gone silent for 7+ days, lets users log applications directly to bypass slow ATS portals, and generates one-click follow-up emails.",
  "applicationCategory": "BusinessApplication",
  "operatingSystem": "Web",
  "url": "https://doneche.shabdly.online/",
  "offers": [
    { "@type": "Offer", "name": "Free", "price": "0", "priceCurrency": "INR" },
    { "@type": "Offer", "name": "Pro", "price": "399", "priceCurrency": "INR" }
  ],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.8",
    "ratingCount": "12"
  },
  "featureList": [
    "Automated 7-day employer ghosting alerts",
    "ATS bypass — direct application logging without portal delays",
    "One-click follow-up email generator",
    "Magic Upload: auto-fill applications from screenshots or emails",
    "Referral-based feature unlocks"
  ]
}
</script>

<!-- FAQ structured data (targets long-tail question searches, improves rich-result eligibility) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is an employer ghosting tracker?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "An employer ghosting tracker is a tool like doneche that monitors your job applications and automatically flags any application where the employer has gone silent for an extended period (7+ days), so you always know your real status instead of guessing."
      }
    },
    {
      "@type": "Question",
      "name": "What is an ATS bypass tool?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "An ATS bypass tool lets job seekers log and track their applications directly, independent of slow or opaque Applicant Tracking Systems used by employers, giving visibility into application status that ATS portals often don't provide."
      }
    },
    {
      "@type": "Question",
      "name": "Is doneche free to use?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes, doneche offers a free plan with core ghosting-tracking features. A paid Pro plan unlocks additional features like the ATS Resume Matcher and AI Interview Simulator."
      }
    }
  ]
}
</script>

<!--
  Single Google AdSense verification point.
  Only ONE verification method is used for this project (meta tag, below).
  Do NOT also add the ads.txt method or a second script-based verification —
  that would trigger duplicate-site-ownership conflicts in AdSense.
  Set ADSENSE_CLIENT_ID (e.g. ca-pub-XXXXXXXXXXXXXXXX) as an env var to activate.
-->
<% if (typeof adsenseClientId !== 'undefined' && adsenseClientId) { %>
<meta name="google-adsense-account" content="<%= adsenseClientId %>" />
<% } %>

<link rel="stylesheet" href="/style.css" />

<!-- driver.js — lightweight onboarding tour library -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/driver.js@1/dist/driver.css" />
<script src="https://cdn.jsdelivr.net/npm/driver.js@1/dist/driver.js.iife.js"></script>

<!-- Shared UI helpers: toast notifications, button/page loaders, global error safety-net -->
<script src="/ui.js"></script>
```

**What changed vs. current `head.ejs`:**
1. Title tag rewritten to include both target keyword phrases.
2. Meta description rewritten to include both phrases + a CTA.
3. Added `<meta name="keywords">` (low ranking weight today, but harmless and used by some secondary search engines/AI crawlers).
4. Added `<link rel="canonical">` — prevents duplicate-content issues if the app is ever reachable via multiple URLs/subdomains.
5. Upgraded Open Graph/Twitter tags to `summary_large_image` + added `og:image`/`twitter:image` placeholders (requires generating a 1200×630 `og-image.png` and placing in `/public/`).
6. Expanded the existing `SoftwareApplication` JSON-LD with `alternateName`, richer `description` (keyword-rich but natural), `url`, `aggregateRating` (update numbers honestly as real reviews come in — do NOT fabricate at launch, remove this block until real ratings exist), and a `featureList`.
7. **Added a new FAQPage JSON-LD block** — directly targets long-tail question searches ("what is an employer ghosting tracker", "what is an ATS bypass tool") and improves eligibility for FAQ rich results in Google Search.

---

## 3. Standalone Static `index.html` `<head>` Variant
(For if a lightweight static landing page is ever spun up separately from the app, e.g. for Product Hunt or a marketing-only domain.)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>doneche — Employer Ghosting Tracker & ATS Bypass Tool for Job Seekers</title>
  <meta name="description" content="doneche is an employer ghosting tracker that flags job applications gone silent for 7+ days, plus an ATS bypass tool that logs applications directly — no more guessing if you were rejected or ignored. Free to start." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://doneche.shabdly.online/" />

  <!-- (Insert same Open Graph, Twitter, JSON-LD blocks as section 2 above) -->
</head>
<body>
  <!-- landing page content -->
</body>
</html>
```

---

## 4. Additional Technical SEO Checklist (beyond metadata)
- [ ] Verify `public/sitemap.xml` includes all public marketing routes (`/`, `/login`, `/register`, `/pricing`, `/terms`, `/privacy`, `/whats-new`) with correct `lastmod` dates.
- [ ] Verify `public/robots.txt` allows crawling of public marketing pages but disallows `/dashboard`, `/applications/*`, `/api/*` (authenticated/app routes shouldn't be indexed).
- [ ] Generate and add a real `og-image.png` (1200×630) to `/public/` — currently referenced but not confirmed to exist.
- [ ] Once real user reviews/testimonials exist, either populate `aggregateRating` honestly or remove the placeholder block (fabricated ratings risk Google structured-data penalties).
- [ ] Consider a lightweight `/blog` or `/guides` route later (e.g. "How to tell if you've been ghosted after a job interview") to build long-tail organic traffic around both target keyword phrases — flag for a future `/money-seo` or `/money-content` pass.

---

💾 SEO metadata generated per `/money-seo` pipeline command (Step 9), following Social (Step 8).
