import dotenv from "dotenv";
import pg from "pg";
import bcrypt from "bcryptjs";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function query(text, params = []) {
    return pool.query(text, params);
}

export async function initDb() {
    await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'guard')),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS guards (
      id SERIAL PRIMARY KEY,
      guard_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'Off_Duty' CHECK (status IN ('On_Duty', 'Off_Duty', 'Panic')),
      site_id TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visitors (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      id_number TEXT,
      phone TEXT,
      email TEXT,
      company TEXT,
      notes TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      visitor_id INTEGER NOT NULL REFERENCES visitors(id),
      host_name TEXT,
      host_contact TEXT,
      site_id TEXT NOT NULL,
      visitor_status TEXT NOT NULL CHECK (visitor_status IN ('Pre-Registered', 'Unannounced')),
      host_response TEXT NOT NULL DEFAULT 'No_Response' CHECK (host_response IN ('Approved', 'Denied', 'No_Response')),
      approval_status TEXT NOT NULL DEFAULT 'Pending' CHECK (approval_status IN ('Pending', 'Approved', 'Denied')),
      approved_by INTEGER REFERENCES users(id),
      denied_by INTEGER REFERENCES users(id),
      denial_reason TEXT,
      appointment_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visitor_codes (
      id SERIAL PRIMARY KEY,
      visit_id INTEGER UNIQUE NOT NULL REFERENCES visits(id),
      code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'used', 'expired')),
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ,
      used_by_guard TEXT
    );

    CREATE TABLE IF NOT EXISTS guard_events (
      id SERIAL PRIMARY KEY,
      guard_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      site_id TEXT NOT NULL,
      gps_coordinates TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      guard_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      gps_coordinates TEXT NOT NULL,
      report_type TEXT NOT NULL CHECK (report_type IN ('SITREP', 'Incident', 'Patrol')),
      priority TEXT,
      summary TEXT,
      photo_url TEXT,
      audio_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      final BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS panic_events (
      id SERIAL PRIMARY KEY,
      guard_id TEXT NOT NULL,
      site_id TEXT NOT NULL,
      gps_coordinates TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      emergency_channel_activated BOOLEAN NOT NULL DEFAULT TRUE,
      notified BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS outbox_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    );
  `);

    const count = await query("SELECT COUNT(*)::int AS c FROM users");
    if (count.rows[0].c === 0) {
        const adminHash = await bcrypt.hash("Admin@123", 10);
        const supervisorHash = await bcrypt.hash("Supervisor@123", 10);
        const guardHash = await bcrypt.hash("Guard@123", 10);

        await query(
            `INSERT INTO users (name, email, password_hash, role) VALUES
       ('System Admin', 'admin@siteops.local', $1, 'admin'),
       ('Site Supervisor', 'supervisor@siteops.local', $2, 'supervisor'),
       ('Primary Guard', 'guard@siteops.local', $3, 'guard')`,
            [adminHash, supervisorHash, guardHash],
        );
    }
}

export async function logAudit(actorUserId, action, entityType, entityId, details = {}) {
    await query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
        [actorUserId ?? null, action, entityType, entityId ? String(entityId) : null, JSON.stringify(details)],
    );
}

export async function enqueueEvent(eventType, payload) {
    await query(`INSERT INTO outbox_events (event_type, payload) VALUES ($1, $2)`, [
        eventType,
        JSON.stringify(payload),
    ]);
}
