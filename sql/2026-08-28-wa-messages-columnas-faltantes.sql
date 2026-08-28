-- ============================================================================
-- 2026-08-28 · Columnas faltantes en jjp_wa_messages (base nueva czzvsqnmxtjzqzioknnn)
-- Motivo: el wa-server inserta mensajes ENTRANTES con estas columnas; sin
--   ellas el CRM pierde todos los mensajes entrantes
--   ("Could not find the 'forwarded' column" a cientos en logs/server.log).
-- Aditivo: SOLO agrega columnas. NO toca filas, campañas, plantillas ni correos.
-- Ejecutar en Supabase SQL editor (proyecto czzvsqnmxtjzqzioknnn).
-- ============================================================================

ALTER TABLE public.jjp_wa_messages
  ADD COLUMN IF NOT EXISTS forwarded      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_to_wa_id TEXT,
  ADD COLUMN IF NOT EXISTS reply_preview  TEXT,
  ADD COLUMN IF NOT EXISTS reply_from     TEXT,
  ADD COLUMN IF NOT EXISTS reaction       TEXT,
  ADD COLUMN IF NOT EXISTS reaction_from  TEXT;