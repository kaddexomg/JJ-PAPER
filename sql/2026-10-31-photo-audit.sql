-- Migration: 20261031_photo_audit.sql
-- Creación de tabla de auditoría fotográfica y saneamiento de fotos erróneas / IA

CREATE TABLE IF NOT EXISTS jjp_photo_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES jjp_products(id) ON DELETE CASCADE,
  variant_id UUID,
  image_url TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ok', 'dudosa', 'incorrecta', 'generada_ia')),
  confidence NUMERIC,
  mismatches JSONB,
  reason TEXT,
  source TEXT DEFAULT 'legado',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Permisos y RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON jjp_photo_audit TO anon, authenticated, service_role;
ALTER TABLE jjp_photo_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "jjp_photo_audit_all_service" ON jjp_photo_audit;
CREATE POLICY "jjp_photo_audit_all_service" ON jjp_photo_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "jjp_photo_audit_select_authenticated" ON jjp_photo_audit;
CREATE POLICY "jjp_photo_audit_select_authenticated" ON jjp_photo_audit
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "jjp_photo_audit_insert_authenticated" ON jjp_photo_audit;
CREATE POLICY "jjp_photo_audit_insert_authenticated" ON jjp_photo_audit
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "jjp_photo_audit_update_authenticated" ON jjp_photo_audit;
CREATE POLICY "jjp_photo_audit_update_authenticated" ON jjp_photo_audit
  FOR UPDATE TO authenticated USING (true);

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_photo_audit_product ON jjp_photo_audit(product_id);
CREATE INDEX IF NOT EXISTS idx_photo_audit_verdict ON jjp_photo_audit(verdict);

-- Cuarentena de productos con fotos falsas / incoherentes identificadas

-- 1. Cepillos para Barrer (c274dc68-1ddd-447c-a6d3-b06cf011997a) - tenía foto de vaso
INSERT INTO jjp_photo_audit (product_id, image_url, verdict, confidence, mismatches, reason, source)
SELECT id, image_url, 'incorrecta', 1.0, 
       '{"tipo": "mismatch", "motivo": "Muestra vaso de papel en vez de cepillo de barrer"}'::jsonb,
       'Incoherencia total de producto: Cepillo para barrer tenía foto de vaso', 'cuarentena_fase1'
FROM jjp_products
WHERE id = 'c274dc68-1ddd-447c-a6d3-b06cf011997a' AND image_url IS NOT NULL;

UPDATE jjp_products SET image_url = NULL WHERE id = 'c274dc68-1ddd-447c-a6d3-b06cf011997a';
UPDATE jjp_product_variants SET image_url = NULL WHERE product_id = 'c274dc68-1ddd-447c-a6d3-b06cf011997a';

-- 2. Toallín Caricias (80 hojas) (bba9d9d6-73d3-44d2-b94a-22014dfe542c) - tenía foto de lechuga verde
INSERT INTO jjp_photo_audit (product_id, image_url, verdict, confidence, mismatches, reason, source)
SELECT id, image_url, 'incorrecta', 1.0,
       '{"tipo": "mismatch", "motivo": "Muestra lechuga verde en vez de toallín de papel"}'::jsonb,
       'Incoherencia de producto: Toallín tenía foto de lechuga', 'cuarentena_fase1'
FROM jjp_products
WHERE id = 'bba9d9d6-73d3-44d2-b94a-22014dfe542c' AND image_url IS NOT NULL;

UPDATE jjp_products SET image_url = NULL WHERE id = 'bba9d9d6-73d3-44d2-b94a-22014dfe542c';
UPDATE jjp_product_variants SET image_url = NULL WHERE product_id = 'bba9d9d6-73d3-44d2-b94a-22014dfe542c';

-- 3. Coletos Microfibra (1611286c-63e4-49ed-97d4-33e378b97536) - tenía pañitos pequeños
INSERT INTO jjp_photo_audit (product_id, image_url, verdict, confidence, mismatches, reason, source)
SELECT id, image_url, 'incorrecta', 0.9,
       '{"tipo": "mismatch", "motivo": "Muestra paños de cocina en vez de coleto para piso"}'::jsonb,
       'Incoherencia de producto: Coleto microfibra tenía foto de paños pequeños', 'cuarentena_fase1'
FROM jjp_products
WHERE id = '1611286c-63e4-49ed-97d4-33e378b97536' AND image_url IS NOT NULL;

UPDATE jjp_products SET image_url = NULL WHERE id = '1611286c-63e4-49ed-97d4-33e378b97536';
UPDATE jjp_product_variants SET image_url = NULL WHERE product_id = '1611286c-63e4-49ed-97d4-33e378b97536';

-- 4. Cualquier producto que contenga URLs de pollinations u otros generadores de difusión
INSERT INTO jjp_photo_audit (product_id, image_url, verdict, confidence, mismatches, reason, source)
SELECT id, image_url, 'generada_ia', 1.0,
       '{"fuente": "pollinations", "motivo": "Foto inventada por difusión de texto"}'::jsonb,
       'Foto ficticia generada con IA Pollinations Flux erradicada del catálogo', 'cuarentena_pollinations'
FROM jjp_products
WHERE image_url ILIKE '%pollinations%';

UPDATE jjp_products SET image_url = NULL WHERE image_url ILIKE '%pollinations%';
UPDATE jjp_product_variants SET image_url = NULL WHERE image_url ILIKE '%pollinations%';
