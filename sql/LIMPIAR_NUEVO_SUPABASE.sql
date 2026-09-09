-- =========================================================================
-- LIMPIAR_NUEVO_SUPABASE.sql
-- ADVERTENCIA: ESTE SCRIPT BORRA TODAS LAS TABLAS Y FUNCIONES DEL ESQUEMA PUBLIC.
-- ¡EJECUTAR SOLO EN LOS NUEVOS PROYECTOS (PROYECTO A, B, C) ANTES DE MIGRAR!
-- ¡NUNCA EJECUTAR EN EL PROYECTO ORIGINAL!
-- =========================================================================

DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Restaurar permisos por defecto de Supabase
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;
