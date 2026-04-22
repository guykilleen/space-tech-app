# Space Tech Design — Build To-Do List

Last updated: 2026-04-23

---

## Major Features

- [x] **Quote register value column** — Change the `value` column in the QB quotes list to reference the Summary total, not the Budget Quantity total
- [x] **Summary page rounding** — Only round up the Unit Price on the Summary page; the displayed Total must equal Qty × Unit Price exactly (no separate rounding on Total)
- [x] **Job creation email notification** — Send an email when a new job is created (recipient TBD)
- [x] **Job creation hours export** — CSV attachment on job notification email to Brenden (job-[number].csv, 15-column format matching his Replit app)
- [ ] **Voice API** — Voice-to-text input in the Quote Builder using OpenAI Whisper (primary) with Web Speech API fallback (offline). Scope:
  - Microphone button on list pages for voice search/filter
  - Microphone buttons on quantity fields in the quote builder for speaking numbers
  - iPhone: prominent, touch-friendly mic button
  - Add `OPENAI_API_KEY` to `server/.env` and `.env.example`

---

## Test Debt

- [x] **Local test DB migration** — Apply `parent_quote_id` migration to local test database so the 37 blocked server tests can run
- [x] **Duplicate Save button** — Fix the duplicate Save button causing 1 failing client test (`locked quote: Revise button is visible and Save Quote is hidden`)

---

## Minor Changes

- [x] **Custom app icon** — Replace default favicon/PWA icon with a Space Tech Design branded icon
- [x] **Labour Hours row height** — Reduce by 25%
- [x] **Subtrades row height** — Reduce by 25%
- [x] **Unit line item banner** — Change the "Product / Category / Qty / Price / UOM / Total" column header banner inside each Unit to match the style of all other banners throughout the app

---

## iPhone Optimisation

- [x] **Unit field layout** — Reconfigure quote builder Unit display so Level dropdown sits directly under Drawing #, and Description is aligned left and full width of the screen
- [x] **Materials/Hardware description** — Abbreviate the description text or reduce the width of the dropdown box to fit mobile screen
- [x] **Products dropdown** — Widen the Products dropdown box on mobile

---

## Completed

- [x] Quote Builder base tables and CRUD
- [x] Price list management
- [x] Contacts management
- [x] Labour hours columns (admin, CNC, edgebander, assembly, delivery, installation)
- [x] Waste percentage per quote
- [x] QB ↔ JT quote linking (quote_id FK)
- [x] Labour rates table with per-unit rate snapshots
- [x] Rate override flags per unit
- [x] Subtrades (2pac, stone, upholstery, glass, steel) with fixed/qty+rate modes
- [x] Quote revisions (parent_quote_id, revision_suffix, revision_sequence)
- [x] Status locking tiers (draft editable / sent soft-lock / accepted+locked hard-lock with escape hatch)
- [x] Revise button (creates numbered revision copy)
- [x] PDF generation via Puppeteer + system Chromium on Railway
- [x] Contact address field
- [x] Job notes field
- [x] iPhone optimisation pass (quote builder layout)
- [x] Summary page and Budget Quantity page
- [x] Labour rate snapshot bug fix (existing quotes no longer affected by rate changes)
- [x] All migrations applied to Neon production (2026-04-14)
