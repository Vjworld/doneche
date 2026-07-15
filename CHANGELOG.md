# Changelog

## v1.4.0 — 2026-07-16

### Added
- Profile page: users can manually enter/edit professional info (title, summary, skills, experience) or auto-fill it from an uploaded resume (PDF) via Claude AI — extracted data is always shown for review/confirmation before saving (nothing is auto-saved without user consent).
- Account menu (nav dropdown): Profile, Settings, Help documentation, and FAQ links added, alongside existing nav items.
- Settings page: theme preference toggle (light/dark), applied app-wide via a `data-theme` attribute and persisted per-user.
- Help documentation page (`/help`) explaining core app features and how to use them.
- FAQ page (`/faq`) with a collapsible list of commonly asked questions.
- Dark theme styling across dashboard, cards, columns, modals, forms, and nav menu.

### Changed
- Dashboard UI decluttered: the two "Milestone Unlock" perk banners are now shown side-by-side in a compact row instead of two tall stacked blocks, cutting vertical space roughly in half.
- Reduced excess padding/margins across the dashboard header, Storage capacity widget, and page container for a tighter, less "boxy" layout.
- "Coming Soon" dashboard carousel now dynamically lists all upcoming features from the `/coming-soon` roadmap (previously only showed 2 hardcoded slides) and auto-advances every 4 seconds with looping, in addition to manual dot navigation.

### Fixed / Audited
- Full manual regression pass across all routes and POST actions (auth, Kanban CRUD, profile, settings, feedback, curated jobs + apply, pricing/upgrade, magic upload endpoints, health check) — all responded with expected status codes and no server crashes.
- Confirmed non-critical local-dev-only Nodemailer credential warning (feedback email alert) is caught gracefully and does not break the feedback submission flow.

## v1.3.0 — 2026-07-15


### Added
- New "Coming Soon" page (`/coming-soon`) previewing the upcoming job-matchmaking engine: Instant Profile Auto-Build, Hyper-Curated Job Matches, and 1-Click Native Applications.
- Early-access waitlist email capture form on the Coming Soon page, backed by a new `waitlist` table (Supabase) / lowdb collection (local dev).
- New database migration `005_create_waitlist_table.sql` and corresponding `schema.sql` update.
- Nav link to "Coming Soon" added across the app.
- New CSS styling for the Coming Soon page (lede text, CTA card, waitlist form, success/error states).
- `/coming-soon` route added to `sitemap.xml`.

## v1.2.0 — 2026-07-15


### Added
- SEO/GEO: `robots.txt`, `sitemap.xml`, Open Graph/Twitter Card meta tags, and JSON-LD `SoftwareApplication` structured data for AI/search discovery.
- Documented Referral & Gamification system, Share App button, and UX polish in README.md and What's New page.

### Changed
- Ghost emoji micro-animation made more visible (larger, faster, more pronounced bob/scale) without being exaggerated.
- Added always-visible "Share App" floating button on the dashboard, wired to the existing referral modal.

## v1.1.0 — 2026-07-14

### Added
- Referral / Gamification system: unique invite links, tiered unlocks (AI Interview Simulator, VIP Resume Matcher, Ghostbuster badge), +5 application slots per referral.
- Celebratory referral toast + confetti animation.
- Shared UI helpers (`public/ui.js`): global toast notifications, button loading-spinners, safety-net error handling.

## v1.0.0 — 2026-07-13

### Added
- Magic Upload: screenshot and PDF parsing (Claude AI) to auto-fill application fields.
- Inbound email auto-tracking via webhook.
- Terms & Conditions / Privacy Policy pages, shared nav partial with active-link highlighting, breadcrumb back-links.
- First-time onboarding tour (driver.js).
