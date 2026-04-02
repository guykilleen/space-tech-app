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
