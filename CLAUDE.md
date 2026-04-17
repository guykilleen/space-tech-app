# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install all dependencies
npm run install:all

# Run full dev environment (client + server concurrently)
npm run dev

# Run server only (port 5000, nodemon)
npm run dev:server

# Run client only (port 3000, CRA dev server)
npm run dev:client

# Build client for production
npm run build

# Database migrations & seeding
npm run db:migrate --prefix server
npm run db:seed --prefix server

# Run client tests
npm test --prefix client
```

## Environment

Copy `server/.env.example` to `server/.env` and fill in:
- `DB_*` vars for local Postgres, or a single `DATABASE_URL`
- `JWT_SECRET` and `JWT_EXPIRES_IN`

In development the CRA dev server proxies `/api/*` to `http://localhost:5000` (configured in `client/package.json`).

## Architecture

Full-stack: **React 18 + Express 4 + PostgreSQL**, deployed to Railway.

### Backend (`server/`)
- **Entry**: `index.js` — mounts all routes under `/api/`, serves built React app in production, global error handler
- **Pattern**: Routes → Controllers → `pg` Pool directly (no ORM)
- **Auth**: JWT Bearer tokens; middleware in `middleware/auth.js` provides `authenticate`, `isAdmin`, `isAdminOrMgr`, `notReadonly` guards
- **File uploads**: `multer` with memory storage; `exceljs` for Excel import in `controllers/importController.js`
- **DB connection**: `config/db.js` — supports both individual `DB_*` env vars and `DATABASE_URL`; SSL enabled when not local

### Frontend (`client/src/`)
- **Entry**: `index.jsx` wraps app in `BrowserRouter` + `AuthProvider`
- **Routing**: `App.jsx` — public `/login`, everything else wrapped in a `PrivateRoute`; Users page restricted to admin/manager
- **Auth state**: `context/AuthContext.jsx` — stores JWT in `localStorage`, provides `user`, `isAdmin`, `isAdminOrMgr`, `canEdit` helpers; interceptor redirects to `/login` on 401
- **API calls**: `utils/api.js` — Axios instance with base URL `/api` and auto-attached `Authorization: Bearer <token>` header
- **Styling**: CSS Modules (`.module.css`) co-located with components/pages

### Database schema (key tables)
- **users**: UUID PK, `role` enum (`admin|manager|workshop|readonly`), `is_active`
- **quotes**: `quote_number` unique, `status` enum (`pending|review|accepted|declined`), `value`
- **jobs**: `job_number` unique, `quote_id` FK → quotes, `parent_job_id` self-referential FK (sub-jobs), per-phase hours columns (`admin_hours`, `machining_hours`, `assembly_hours`, `delivery_hours`, `install_hours`), `total_hours` computed, WIP fields (`wip_start_date`, `wip_due_date`, `percent_complete`, `wip_completed`)

### Role-based access
- `admin` — full access including user management
- `manager` — same as admin except cannot manage users
- `workshop` — can view and update WIP; cannot create/edit quotes or jobs
- `readonly` — view only

## Database Migrations

All migrations must be run against the Neon production database manually via the Neon SQL Editor at neon.tech. There is no automated migration runner — each file is a standalone Node.js script whose SQL must be extracted and run by hand.

**Rules:**
- Every time a new migration file is created, add it to this table with status ⏳ Pending
- Remind the user to run it against Neon before testing on the live site
- Update status to ✅ Applied once the user confirms it has been run

| Migration File | Description | Neon Status |
|---|---|---|
| `server/db/seed.js` | Seeds initial users | ✅ Applied |
| `server/db/qb_migrate.js` | Base Quote Builder tables: `qb_contacts`, `qb_price_list`, `qb_quote_headers`, `qb_quote_units`, `qb_quote_unit_lines` | ✅ Applied |
| `server/db/qb_seed_prices.js` | Seeds default price list items | ✅ Applied |
| `server/db/qb_migrate_labour.js` | Adds `admin_hours`, `cnc_hours`, `edgebander_hours`, `assembly_hours` to `qb_quote_units` | ✅ Applied |
| `server/db/qb_migrate_waste.js` | Adds `waste_pct` to `qb_quote_headers` | ✅ Applied |
| `server/db/qb_migrate_link.js` | Adds `quote_id` FK + unique index to `qb_quote_headers` (links QB quotes to JT quotes) | ✅ Applied |
| `server/db/qb_migrate_labour_rates.js` | Creates `labour_rates` table, seeds 6 default rates, adds `delivery_hours`, `installation_hours`, and 6 `*_rate` snapshot columns to `qb_quote_units` | ✅ Applied |
| `server/db/qb_migrate_rate_overrides.js` | Adds `price_overridden` to `qb_quote_unit_lines`; adds 6 `*_rate_overridden` flags + `rates_last_synced_at` to `qb_quote_units` | ✅ Applied |
| `server/db/qb_migrate_contact_address.js` | Adds `address` column to `qb_contacts` | ✅ Applied |
| `server/db/migrate_jobs_notes.js` | Adds `notes` column to `jobs` | ✅ Applied |
| `server/db/migrate_subtrades.js` | Creates `qb_unit_subtrades` table; adds `subtrade_margin` to `qb_quote_units` | ✅ Applied |
| `server/db/qb_add_polytec_wm.js` | Seeds Polytec Woodmatt price list entries | ✅ Applied |
| `server/db/qb_migrate_revisions.js` | Adds `parent_quote_id`, `revision_suffix`, `revision_sequence` to `qb_quote_headers`; extends status CHECK to include `submitted` and `locked` | ✅ Applied |
| `server/db/migrate_quotes_status_simplify.js` | Migrates `quotes.status` to `draft\|sent\|accepted` only (pending→draft, review→sent, declined→sent); updates CHECK constraint | ⏳ Pending |
| `server/db/migrate_qb_status_simplify.js` | Migrates `qb_quote_headers.status` to `draft\|sent\|accepted` only (submitted→sent, declined→sent, locked→accepted); updates CHECK constraint | ⏳ Pending |
