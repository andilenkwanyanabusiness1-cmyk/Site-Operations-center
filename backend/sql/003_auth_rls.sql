-- Supabase Auth + RLS enforcement for Site Operations
-- Run after 001_schema.sql

-- 1) Profile table linked to Supabase auth.users
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'guard' CHECK (role IN ('admin', 'supervisor', 'guard')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Auto-provision profile when auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    COALESCE(NEW.raw_app_meta_data ->> 'role', 'guard')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- 3) Role helper functions used by RLS policies
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    (SELECT up.role FROM public.user_profiles up WHERE up.id = auth.uid() AND up.active = TRUE),
    'guard'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_supervisor_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() IN ('admin', 'supervisor');
$$;

CREATE OR REPLACE FUNCTION public.is_any_app_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_app_role() IN ('admin', 'supervisor', 'guard');
$$;

-- 4) Guardrails for one-time code check-in behavior by guards
CREATE OR REPLACE FUNCTION public.enforce_visitor_code_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.current_app_role() = 'guard' THEN
    IF OLD.status <> 'issued' OR NEW.status <> 'used' THEN
      RAISE EXCEPTION 'Guard can only consume issued visitor code once';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visitor_code_guard_update ON public.visitor_codes;
CREATE TRIGGER trg_visitor_code_guard_update
  BEFORE UPDATE ON public.visitor_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_visitor_code_guard_update();

-- 5) Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guard_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- 6) user_profiles policies
DROP POLICY IF EXISTS "profiles_self_select" ON public.user_profiles;
CREATE POLICY "profiles_self_select"
ON public.user_profiles FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_admin() OR public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "profiles_admin_manage" ON public.user_profiles;
CREATE POLICY "profiles_admin_manage"
ON public.user_profiles FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 7) users policies (legacy app user table)
DROP POLICY IF EXISTS "users_read_admin_supervisor" ON public.users;
CREATE POLICY "users_read_admin_supervisor"
ON public.users FOR SELECT
TO authenticated
USING (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "users_admin_manage" ON public.users;
CREATE POLICY "users_admin_manage"
ON public.users FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 8) guards policies
DROP POLICY IF EXISTS "guards_read_all_app_roles" ON public.guards;
CREATE POLICY "guards_read_all_app_roles"
ON public.guards FOR SELECT
TO authenticated
USING (public.is_any_app_user());

DROP POLICY IF EXISTS "guards_admin_manage" ON public.guards;
CREATE POLICY "guards_admin_manage"
ON public.guards FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 9) visitors policies
DROP POLICY IF EXISTS "visitors_read_all_app_roles" ON public.visitors;
CREATE POLICY "visitors_read_all_app_roles"
ON public.visitors FOR SELECT
TO authenticated
USING (public.is_any_app_user());

DROP POLICY IF EXISTS "visitors_admin_manage" ON public.visitors;
CREATE POLICY "visitors_admin_manage"
ON public.visitors FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 10) visits policies
DROP POLICY IF EXISTS "visits_read_all_app_roles" ON public.visits;
CREATE POLICY "visits_read_all_app_roles"
ON public.visits FOR SELECT
TO authenticated
USING (public.is_any_app_user());

DROP POLICY IF EXISTS "visits_insert_admin_supervisor" ON public.visits;
CREATE POLICY "visits_insert_admin_supervisor"
ON public.visits FOR INSERT
TO authenticated
WITH CHECK (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "visits_update_admin_supervisor" ON public.visits;
CREATE POLICY "visits_update_admin_supervisor"
ON public.visits FOR UPDATE
TO authenticated
USING (public.is_supervisor_or_admin())
WITH CHECK (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "visits_delete_admin_only" ON public.visits;
CREATE POLICY "visits_delete_admin_only"
ON public.visits FOR DELETE
TO authenticated
USING (public.is_admin());

-- 11) visitor_codes policies
DROP POLICY IF EXISTS "visitor_codes_read_all_app_roles" ON public.visitor_codes;
CREATE POLICY "visitor_codes_read_all_app_roles"
ON public.visitor_codes FOR SELECT
TO authenticated
USING (public.is_any_app_user());

DROP POLICY IF EXISTS "visitor_codes_insert_admin_supervisor" ON public.visitor_codes;
CREATE POLICY "visitor_codes_insert_admin_supervisor"
ON public.visitor_codes FOR INSERT
TO authenticated
WITH CHECK (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "visitor_codes_update_admin_supervisor" ON public.visitor_codes;
CREATE POLICY "visitor_codes_update_admin_supervisor"
ON public.visitor_codes FOR UPDATE
TO authenticated
USING (public.is_supervisor_or_admin())
WITH CHECK (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "visitor_codes_update_guard_consume" ON public.visitor_codes;
CREATE POLICY "visitor_codes_update_guard_consume"
ON public.visitor_codes FOR UPDATE
TO authenticated
USING (public.current_app_role() = 'guard')
WITH CHECK (public.current_app_role() = 'guard' AND status = 'used');

-- 12) guard_events policies
DROP POLICY IF EXISTS "guard_events_read_admin_supervisor" ON public.guard_events;
CREATE POLICY "guard_events_read_admin_supervisor"
ON public.guard_events FOR SELECT
TO authenticated
USING (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "guard_events_insert_all_app_roles" ON public.guard_events;
CREATE POLICY "guard_events_insert_all_app_roles"
ON public.guard_events FOR INSERT
TO authenticated
WITH CHECK (public.is_any_app_user());

-- 13) reports policies (immutable after insert by omission of update policy)
DROP POLICY IF EXISTS "reports_read_admin_supervisor" ON public.reports;
CREATE POLICY "reports_read_admin_supervisor"
ON public.reports FOR SELECT
TO authenticated
USING (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "reports_insert_all_app_roles" ON public.reports;
CREATE POLICY "reports_insert_all_app_roles"
ON public.reports FOR INSERT
TO authenticated
WITH CHECK (public.is_any_app_user());

-- 14) panic_events policies
DROP POLICY IF EXISTS "panic_read_admin_supervisor" ON public.panic_events;
CREATE POLICY "panic_read_admin_supervisor"
ON public.panic_events FOR SELECT
TO authenticated
USING (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "panic_insert_all_app_roles" ON public.panic_events;
CREATE POLICY "panic_insert_all_app_roles"
ON public.panic_events FOR INSERT
TO authenticated
WITH CHECK (public.is_any_app_user());

-- 15) audit_logs policies
DROP POLICY IF EXISTS "audit_read_admin_supervisor" ON public.audit_logs;
CREATE POLICY "audit_read_admin_supervisor"
ON public.audit_logs FOR SELECT
TO authenticated
USING (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "audit_insert_all_app_roles" ON public.audit_logs;
CREATE POLICY "audit_insert_all_app_roles"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (public.is_any_app_user());

-- 16) outbox_events policies
DROP POLICY IF EXISTS "outbox_read_admin_supervisor" ON public.outbox_events;
CREATE POLICY "outbox_read_admin_supervisor"
ON public.outbox_events FOR SELECT
TO authenticated
USING (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "outbox_insert_admin_supervisor" ON public.outbox_events;
CREATE POLICY "outbox_insert_admin_supervisor"
ON public.outbox_events FOR INSERT
TO authenticated
WITH CHECK (public.is_supervisor_or_admin());

DROP POLICY IF EXISTS "outbox_update_admin_supervisor" ON public.outbox_events;
CREATE POLICY "outbox_update_admin_supervisor"
ON public.outbox_events FOR UPDATE
TO authenticated
USING (public.is_supervisor_or_admin())
WITH CHECK (public.is_supervisor_or_admin());
