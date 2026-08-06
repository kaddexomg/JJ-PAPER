-- Migración: Precios personalizados por vendedor
-- Creado: 2026-08-06

-- 1. Crear la tabla de precios personalizados por vendedor
CREATE TABLE IF NOT EXISTS public.jjp_seller_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES public.jjp_profiles(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.jjp_products(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES public.jjp_product_variants(id) ON DELETE CASCADE,
    price_usd NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Índices únicos para garantizar que un vendedor solo tenga un precio personalizado por producto/variante
CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_with_variant 
ON public.jjp_seller_prices (seller_id, product_id, variant_id) 
WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS jjp_seller_prices_unique_no_variant 
ON public.jjp_seller_prices (seller_id, product_id) 
WHERE variant_id IS NULL;

-- 3. Habilitar RLS en la tabla
ALTER TABLE public.jjp_seller_prices ENABLE ROW LEVEL SECURITY;

-- 4. Crear las políticas de RLS
-- Cualquiera (incluyendo anon o visitantes de catálogo, aunque no lo usen directamente) puede leer para consistencia
CREATE POLICY "Cualquiera puede leer precios personalizados" 
ON public.jjp_seller_prices FOR SELECT 
USING (true);

-- Solo el vendedor dueño de la fila puede insertar, actualizar o eliminar sus precios
CREATE POLICY "Vendedores pueden gestionar sus propios precios" 
ON public.jjp_seller_prices FOR ALL 
USING (auth.uid() = seller_id);
