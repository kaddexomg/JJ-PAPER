-- ======================================================
-- MIGRACION COMPLETA: PLANTILLAS Y DIFUSION WHATSAPP
-- ======================================================

-- 1. Tabla de Plantillas
create table if not exists public.jjp_wa_templates (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references public.jjp_profiles(id) on delete cascade,
  name       text not null,
  body       text not null,
  kind       text not null default 'general' check (kind in ('general','reactivacion','catalogo_corporativo','oferta')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
) using heap;

create index if not exists jjp_wa_templates_owner on public.jjp_wa_templates (owner_id, active);

alter table public.jjp_wa_templates enable row level security;

drop policy if exists wa_tpl_sel on public.jjp_wa_templates;
create policy wa_tpl_sel on public.jjp_wa_templates for select to authenticated
  using (owner_id = auth.uid() or owner_id is null or public.jjp_is_admin());

drop policy if exists wa_tpl_ins on public.jjp_wa_templates;
create policy wa_tpl_ins on public.jjp_wa_templates for insert to authenticated
  with check (owner_id = auth.uid() or (owner_id is null and public.jjp_is_admin()) or public.jjp_is_admin());

drop policy if exists wa_tpl_upd on public.jjp_wa_templates;
create policy wa_tpl_upd on public.jjp_wa_templates for update to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin())
  with check (owner_id = auth.uid() or public.jjp_is_admin());

drop policy if exists wa_tpl_del on public.jjp_wa_templates;
create policy wa_tpl_del on public.jjp_wa_templates for delete to authenticated
  using (owner_id = auth.uid() or public.jjp_is_admin());

-- 2. Plantillas Profesionales B2B Pre-guardadas
insert into public.jjp_wa_templates (owner_id, name, body, kind)
values
(
  null,
  '💼 Presentación Corporativa B2B (Catálogo Mayorista)',
  'Estimados señores de *{{empresa}}* 🏢, un cordial saludo.

Le escribe *{{vendedor}}*, asesor comercial oficial de *JJ Paper*.

Nos dirigimos a ustedes para presentarles nuestra línea de suministros corporativos, papelería al mayor, resmas, consumibles de oficina y artículos de limpieza institucional con entrega directa a su empresa y atención personalizada.

📄 Puede consultar nuestro catálogo digital completo y lista de precios actualizada en el siguiente enlace:
👉 {{link}}

Estamos a su total disposición para cotizaciones formales con RIF y facturación fiscal. ¿Tienen algún requerimiento pendiente esta semana? ¡Será un gusto atenderles! 🤝',
  'catalogo_corporativo'
),
(
  null,
  '📦 Surtido de Oficina y Papelería Mensual',
  'Hola {{nombre}} 👋, le saluda *{{vendedor}}* de *JJ Paper*.

Esperamos que todo marche excelente en *{{empresa}}*. Le compartimos nuestro catálogo interactivo para la reposición periódica de sus artículos de oficina, archivo, impresión y papelería:
👉 {{link}}

💡 *Beneficios corporativos:*
• Precios especiales por volumen al mayor.
• Despacho directo a su sede.
• Atención directa para órdenes de compra y presupuestos.

Quedo a su disposición para prepararle una propuesta a la medida de su empresa.',
  'general'
),
(
  null,
  '🔥 Oferta Especial y Descuento Mayorista',
  'Hola {{nombre}} 👋, le escribe *{{vendedor}}* de *JJ Paper*.

Queremos ofrecerle a *{{empresa}}* una condición especial: realizando su pedido o cotización por nuestro portal digital obtiene un *{{descuento}}% de descuento* en su compra mayorista.

📲 Explore nuestro catálogo aquí:
👉 {{link}}

Cualquier duda o requerimiento puntual con gusto se lo cotizo de inmediato. ¡Que tenga un excelente día!',
  'oferta'
),
(
  null,
  '🔄 Reactivación de Cuenta Corporativa',
  'Estimado/a {{nombre}} 👋, le saluda *{{vendedor}}* de *JJ Paper*.

Revisando nuestros registros notamos que hace un tiempo no les despachamos sus suministros de oficina en *{{empresa}}*.

Queremos ponernos nuevamente a la orden y facilitarles la reposición de stock. Les dejamos nuestro catálogo con disponibilidad inmediata:
👉 {{link}}

¿En qué les podemos colaborar hoy? ¡Un cordial saludo!',
  'reactivacion'
)
on conflict do nothing;
