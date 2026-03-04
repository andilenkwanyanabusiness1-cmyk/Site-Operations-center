# Site Operations Portal

Security-first visitor and guard operations system with strict rule enforcement.

## Stack

- Frontend: React (Vite)
- Backend: Node.js + Express
- Database: PostgreSQL

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

### 1) PostgreSQL

Create a DB and set connection string in backend `.env`.

Example:

```
DATABASE_URL=postgres://postgres:postgres@localhost:5432/site_ops
JWT_SECRET=change-me
PORT=4000
```

### 2) Backend

```bash
cd backend
npm install
npm run dev
```

Backend auto-creates schema on startup and seeds default users.

### 3) Frontend

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
