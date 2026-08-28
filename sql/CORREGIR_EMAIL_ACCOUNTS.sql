-- ============================================================
-- JJ PAPER — CORREGIR jjp_email_accounts (columnas correctas)
-- Ejecutar en SQL Editor de Supabase (czzvsqnmxtjzqzioknnn)
-- ============================================================

-- La tabla existe pero con columnas incorrectas (owner_id, active, verified_at)
-- El código frontend y backend usa: profile_id, enabled, verified, last_error, from_name, has_cred

-- 1. Hacer backup de datos existentes (por si hay algo)
CREATE TABLE IF NOT EXISTS public._bak_email_accounts AS SELECT * FROM public.jjp_email_accounts;

-- 2. Eliminar y recrear con esquema correcto
DROP TABLE IF EXISTS public.jjp_email_accounts CASCADE;

CREATE TABLE public.jjp_email_accounts (
  profile_id    UUID PRIMARY KEY REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  from_name     TEXT,
  provider      TEXT DEFAULT 'google',
  oauth_refresh TEXT,
  app_pass      TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  verified      BOOLEAN NOT NULL DEFAULT false,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Columna computada: el front pide "has_cred" para saber si hay credencial
  -- sin nunca exponer el token/pass al navegador
  has_cred      BOOLEAN GENERATED ALWAYS AS (
    (oauth_refresh IS NOT NULL AND oauth_refresh <> '') OR
    (app_pass IS NOT NULL AND app_pass <> '')
  ) STORED
);

ALTER TABLE public.jjp_email_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jjp_email_accounts_own ON public.jjp_email_accounts;
CREATE POLICY jjp_email_accounts_own ON public.jjp_email_accounts FOR ALL TO authenticated
  USING (profile_id = auth.uid() OR public.jjp_is_admin())
  WITH CHECK (profile_id = auth.uid() OR public.jjp_is_admin());

-- Seguridad: el navegador NO debe poder leer oauth_refresh ni app_pass
-- Solo el service_role (wa-server) las lee
REVOKE ALL ON public.jjp_email_accounts FROM anon;
GRANT SELECT (profile_id, email, from_name, provider, enabled, verified, last_error, has_cred, created_at, updated_at) ON public.jjp_email_accounts TO authenticated;
GRANT INSERT, UPDATE (profile_id, email, from_name, provider, oauth_refresh, app_pass, enabled, verified, last_error) ON public.jjp_email_accounts TO authenticated;
GRANT DELETE ON public.jjp_email_accounts TO authenticated;

-- Publicar en Realtime para que el chip 🟢/🔴 se actualice en vivo
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.jjp_email_accounts;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL;
END $$;

-- 3. Limpiar backup temporal
DROP TABLE IF EXISTS public._bak_email_accounts;

-- 4. Recargar schema cache
NOTIFY pgrst, 'reload schema';
