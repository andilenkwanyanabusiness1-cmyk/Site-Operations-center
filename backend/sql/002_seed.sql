-- Seed users for Site Operations (Supabase Postgres)
-- Uses pgcrypto bcrypt hashing directly in SQL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO users (name, email, password_hash, role)
VALUES
  ('System Admin', 'admin@siteops.local', crypt('Admin@123', gen_salt('bf', 10)), 'admin'),
  ('Site Supervisor', 'supervisor@siteops.local', crypt('Supervisor@123', gen_salt('bf', 10)), 'supervisor'),
  ('Primary Guard', 'guard@siteops.local', crypt('Guard@123', gen_salt('bf', 10)), 'guard')
ON CONFLICT (email) DO NOTHING;
