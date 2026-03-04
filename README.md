# Site Operations Portal

Security-first visitor and guard operations system with strict rule enforcement.

## Stack

- Frontend: React (Vite)
- Backend: Node.js + Express
- Database: Supabase PostgreSQL

## Features Implemented

- Role-based access (`admin`, `supervisor`, `guard`)
- Admin guard CRUD (add/edit/deactivate)
- Admin visitor CRUD
- Visitor approval queue with approve/deny
- One-time unique visitor codes on approval
- Guard code lookup and check-in
- Gate constraints (unannounced denied unless admin override + MFA token)
- Reporting rules:
  - SITREP requires summary
  - High-priority Incident requires photo + audio
  - Reports are immutable (no edit endpoints)
- Panic endpoint for immediate escalation event logging
- Audit logging for sensitive actions
- Basic outbox events table for async sync/retry architecture

## Project Layout

```
backend/
frontend/
```

## Setup

### 1) Supabase Project Setup

Create a Supabase project, then set backend env vars in `backend/.env`.

Use `backend/.env.example` as template.

Required values:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_DB_URL=postgres://... (from Supabase Database settings)
JWT_SECRET=change-me
PORT=4000
AUTO_INIT_DB=false
```

> `SUPABASE_DB_URL` is used by the backend API via `pg` driver.

### 2) Apply SQL schema + seed in Supabase

In Supabase SQL editor, run:

1. `backend/sql/001_schema.sql`
2. `backend/sql/002_seed.sql`

This creates all required tables and default users.

### 3) Backend

```bash
cd backend
npm install
npm run dev
```

If `AUTO_INIT_DB=true`, backend auto-creates schema and seeds users.

For Supabase production, keep `AUTO_INIT_DB=false` and rely on SQL migration files.

### 4) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend expects backend at `http://localhost:4000`.

## Seed Users

- Admin: `admin@siteops.local` / `Admin@123`
- Supervisor: `supervisor@siteops.local` / `Supervisor@123`
- Guard: `guard@siteops.local` / `Guard@123`

## Protocol Notes

- Guard cannot manually override unannounced entry.
- Visitor code is one-time and marked `used` on successful check-in.
- Reports are final after submission.
- Every sensitive operation is audit-logged.

## Supabase Notes

- Backend is now configured to use `SUPABASE_DB_URL` preferentially.
- SSL is enabled automatically for Supabase DB connections.
- SQL migration files are in `backend/sql/`.
