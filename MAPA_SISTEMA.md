# 🗺️ MAPA DEL SISTEMA — JJ Paper C.A.

> Referencia técnica completa. Consulta este archivo para localizar cualquier
> funcionalidad sin necesidad de leer todo el código fuente.
> Última actualización: 2026-09-16

---

## 1. Páginas del Sistema (54 total)

### Públicas (11 páginas)
| Página | Archivo | Qué hace |
|---|---|---|
| Tienda | `index.html` | Hero, productos destacados, carrito flotante |
| Catálogo | `catalogo.html` | Filtrado facetado, búsqueda, variantes |
| Producto | `producto.html` | Ficha individual, galería, stock |
| Checkout | `checkout.html` | Pasarela de pago, comprobante |
| Pedidos | `pedidos.html` | Consulta de órdenes por cliente |
| Rastreo | `rastreo.html` | Seguimiento con mapa OpenStreetMap |
| Promos | `promociones.html` | Ofertas y cupones vigentes |
| Lista Precios | `lista_costos.html` | Imprimible A-Z, 13-15 páginas |
| Comprobante | `comprobante.html` | Generador de recibos digitales |
| Diagnóstico | `diag.html` | Test de compatibilidad del navegador |
| 404 | `404.html` | Página de error personalizada |

### Admin (28 páginas)
| Página | Archivo | JS Principal | Qué hace |
|---|---|---|---|
| Dashboard | `admin/index.html` | `dashboard.js` | Métricas consolidadas |
| Login | `admin/login.html` | `auth.js` | Google OAuth |
| POS | `admin/pos.html` | `pos.js` | Venta directa, escáner, cobro |
| Cotizador | `admin/cotizador.html` | `vquotes.js` | Presupuestos mayoristas |
| Cotizaciones | `admin/cotizaciones.html` | `quotes.js` | Control y conversión |
| Pedidos | `admin/pedidos.html` | `orders.js` | Gestión de órdenes |
| Clientes | `admin/clientes.html` | `aclients.js` | CRM global |
| Prospectos | `admin/prospectos.html` | `vprospectos.js` | Captación B2B + IA |
| Productos | `admin/productos.html` | `products.js` | CRUD catálogo |
| Catálogo | `admin/catalogo.html` | - | Vista rápida interna |
| Precios | `admin/precios.html` | `pricing.js` | Gestor masivo |
| Listas Precios | `admin/listas-precios.html` | `vlistas-precios.js` | Generador PDF |
| Marcas | `admin/marcas.html` | `brands.js` | CRUD marcas |
| Unidades | `admin/unidades.html` | `units.js` | Unidades de medida |
| Promos | `admin/promociones.html` | `promos.js` | Cupones y banners |
| Reseñas | `admin/resenas.html` | - | Moderación |
| Vendedores | `admin/vendedores.html` | `sellers.js` | Gestión de personal |
| Inventario | `admin/inventario.html` | `inventory.js` | Stock y kardex |
| Conteo | `admin/conteo.html` | `count-control.js` | Inventario físico |
| Escáner | `admin/escaner.html` | `inv-scan.js` | Captura códigos de barra |
| Facturas | `admin/facturas.html` | `invoices.js` | Cuentas por pagar |
| LAN | `admin/lan.html` | - | Monitor servidor offline |
| Monitor | `admin/monitor.html` | `monitor-client.js` | Cuotas Supabase |
| WhatsApp | `admin/whatsapp.html` | `wa-chat.js` | CRM WhatsApp multiagente |
| Difusión | `admin/difusion.html` | `vdifusion.js` | Campañas masivas WA |
| Correo | `admin/correo.html` | `correo.js` | Gmail API + IA |
| Campañas Email | `admin/campanas-email.html` | `vcampanas-email.js` | Email masivo |
| Ajustes | `admin/ajustes.html` | `settings.js` | Config global |

### Vendedor (15 páginas)
| Página | Archivo | JS Principal |
|---|---|---|
| Dashboard | `vendedor/index.html` | `vdashboard.js` |
| POS | `vendedor/pos.html` | `pos.js` |
| Cotizador | `vendedor/cotizador.html` | `vquotes.js` |
| Cotizaciones | `vendedor/cotizaciones.html` | `vquotes-list.js` |
| Pedidos | `vendedor/pedidos.html` | `vorders.js` |
| Clientes | `vendedor/clientes.html` | `vcustomers.js` |
| Productos | `vendedor/productos.html` | `vproducts.js` |
| Catálogo | `vendedor/catalogo.html` | `vcatalogo.js` |
| Consulta | `vendedor/consulta.html` | `consulta.js` |
| Escáner | `vendedor/scan.html` | `scan.js` |
| WhatsApp | `vendedor/whatsapp.html` | `wa-chat.js` |
| Difusión | `vendedor/difusion.html` | `vdifusion.js` |
| Correo | `vendedor/correo.html` | `correo.js` |
| Campañas Email | `vendedor/campanas-email.html` | `vcampanas-email.js` |
| Ajustes | `vendedor/ajustes.html` | `vajustes.js` |

---

## 2. Niveles de Precio

El sistema maneja 5 niveles de precio heredados de MixNet:

| Nivel | Columna BD | Moneda | Uso | Quién lo ve |
|---|---|---|---|---|
| **A** | `price_a` | USD ($) | Detal / Lista general | POS, Cotizador |
| **B** | `price_b` | USD ($) | Mayor / Distribuidor | **Defecto en POS** |
| **B sync** | `price_usd` | USD ($) | Sincronizado con B | Tienda pública, catálogo |
| **C** | `price_c_bs` | Bolívares | Nivel fijo en Bs | POS (conv. a USD vía BCV) |
| **D** | `price_d_bs` | Bolívares | Nivel fijo en Bs | POS (conv. a USD vía BCV) |
| **M** | Manual | USD ($) | Precio libre | Solo en transacción |
| **Vendedor** | `jjp_seller_prices` | USD ($) | Sobreescribe B | Solo ese vendedor |

### Prioridad en el Código
- **POS/Cotizador**: `price_b` → fallback `price_usd`
- **Catálogo PDF**: `price_b` → `price_usd` → `price_a`
- **Tienda web pública**: solo `price_usd`
- **IA/Copiloto**: `price_b` → `price_usd`

---

## 3. Flujos Críticos de Negocio

### Cotización → Pedido → Venta
```
[Cotizador] → INSERT jjp_quotes (status='pendiente')
     │
     ├── Opción A: "Convertir en pedido" (backend RPC jjp_convert_quote)
     │     └── INSERT jjp_orders + UPDATE jjp_quotes status='convertido'
     │
     └── Opción B: "Cobrar en POS" (pos.html?quote=COT-XXXX)
           ├── posLoadQuote() → valida status !== 'convertido'
           ├── Vendedor modifica cantidades/precios
           └── posSubmit() → INSERT jjp_orders con quote_id + customer_id
                              + UPDATE jjp_quotes status='convertido'
```

### Campaña Masiva (WhatsApp o Email)
```
[Editor de Campañas] → Seleccionar audiencia + modo (IA o Plantilla)
     │
     ├── Si modo IA: "⚡ Analizar con IA" → Gemini genera mensaje por sector
     │     └── Cada contacto recibe _custom_message personalizado
     │
     └── Si modo Plantilla: usa plantilla base (con productos y 4 pilares)
     │
     ▼
[Lanzar] → INSERT jjp_*_campaigns + jjp_*_campaign_targets
     │
     ▼
[wa-server] → campaigns.js / email-campaigns.js
     ├── Resuelve variables {{nombre}}, {{empresa}}, etc.
     ├── Resuelve Spintax {A|B|C}
     ├── Adjunta PDF/flyer si media_path != null
     └── Envía con throttling anti-baneo (45-90s entre mensajes)
```

### Sincronización MixNet
```
Cada 5 minutos (mixer.js sweepMixnetProducts):
  MixNet DBF/HTTP → Lee precios A/B/C/D + stock
                   → UPDATE jjp_products + jjp_product_variants
                   → (price_a, price_b, price_usd, price_c_bs, price_d_bs, stock)

Al crear pedido en JJ Paper:
  jjp_orders INSERT → mixer.js exportOrder()
                    → Escribe pedido_[ID].csv + .txt en drop_dirs
                    → PC MixNet recoge y factura
```

---

## 4. Variables de Entorno Clave

### Frontend (`assets/js/config.js` — hardcodeado)
```javascript
SUPABASE_A_URL = 'https://wwcdxqpibequfohbgejs.supabase.co'
SUPABASE_B_URL = 'https://klcibjwleiqppedefpxw.supabase.co'
SUPABASE_C_URL = 'https://nmcamjxhyysmmvgxgabo.supabase.co'
// Anon keys están en el mismo archivo
```

### Backend (`wa-server/.env`)
```env
SUPABASE_URL_CORE=https://wwcdxqpibequfohbgejs.supabase.co
SUPABASE_KEY=<service_role_key_A>
SUPABASE_COMM_URL=https://klcibjwleiqppedefpxw.supabase.co
SUPABASE_COMM_KEY=<service_role_key_B>
SUPABASE_INV_URL=https://nmcamjxhyysmmvgxgabo.supabase.co
SUPABASE_INV_KEY=<service_role_key_C>
GOOGLE_CLIENT_ID=<oauth_client_id>
GOOGLE_CLIENT_SECRET=<oauth_client_secret>
```

---

## 5. Esquema de la Base de Datos (Tablas Principales)

### jjp_customers (Proyecto A)
```sql
id UUID PK, rif TEXT, company_name TEXT, contact_name TEXT,
phone TEXT, email TEXT, address TEXT, city TEXT,
seller_id UUID FK→jjp_profiles, zone TEXT,
sector TEXT, notes TEXT, total_orders INT, total_usd NUMERIC,
credit_limit NUMERIC, credit_days INT,
custom_wa_body TEXT, custom_email_body TEXT,
ai_analysis JSONB, created_at TIMESTAMPTZ
```

### jjp_orders (Proyecto A)
```sql
id UUID PK, order_number TEXT UNIQUE,
client_name TEXT, rif TEXT, phone TEXT, email TEXT,
items JSONB, -- [{id, variant_id, sku, name, qty, price_usd, subtotal_usd}]
subtotal_usd NUMERIC, total_usd NUMERIC,
exchange_rate NUMERIC, total_bs NUMERIC,
payment_method TEXT, payment_ref TEXT,
status TEXT, -- pendiente_pago/verificando/pagado/preparando/entregado/cancelado
seller_id UUID, source TEXT, -- web/pos/ref
quote_id UUID FK→jjp_quotes, customer_id UUID FK→jjp_customers,
discount_pct NUMERIC, discount_status TEXT, -- none/pending/approved/rejected
stock_applied BOOLEAN, delivery_type TEXT,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### jjp_quotes (Proyecto A)
```sql
id UUID PK, quote_number TEXT UNIQUE,
client_name TEXT, rif TEXT, phone TEXT, email TEXT,
items JSONB, estimated_total_usd NUMERIC,
discount_pct NUMERIC, exchange_rate NUMERIC,
status TEXT, -- pendiente/contactado/confirmado/convertido/cancelado/rechazado
seller_id UUID, customer_id UUID,
created_at TIMESTAMPTZ
```

### jjp_product_variants (Proyecto A)
```sql
id UUID PK, product_id UUID FK→jjp_products,
name TEXT, sku TEXT, barcode TEXT,
price_usd NUMERIC, price_a NUMERIC, price_b NUMERIC,
price_c_bs NUMERIC, price_d_bs NUMERIC,
cost_usd NUMERIC, base_price_usd NUMERIC,
stock INT, min_stock INT, unit TEXT,
image_url TEXT, active BOOLEAN,
created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

---

## 6. Cerebro — Índice de Documentación

Para entender un tema específico, lee el archivo correspondiente:

| Necesitas entender... | Lee... |
|---|---|
| Cómo funciona el sistema completo | `cerebro/CONTEXTO.md` |
| Por dónde empezar | `cerebro/INICIO.md` |
| Clientes, zonas, carteras | `cerebro/Conceptos/Cliente.md` + `Gestion_Clientes_Zonas_JJ_PAPER.md` |
| Productos, variantes, precios | `cerebro/Conceptos/Producto y variante.md` |
| Cotizaciones | `cerebro/Conceptos/Cotizacion.md` |
| Pedidos | `cerebro/Conceptos/Pedido.md` |
| Dinero, tasas BCV/USDT | `cerebro/Conceptos/Dinero y tasas.md` |
| Inventario, stock, conteo | `cerebro/Conceptos/Stock.md` + `cerebro/Modulos/Inventario y conteo.md` |
| WhatsApp CRM | `cerebro/Modulos/CRM WhatsApp.md` |
| Campañas masivas | `cerebro/Modulos/Difusion.md` |
| Correo Gmail | `cerebro/Modulos/Correo.md` |
| POS y Cotizador | `cerebro/Modulos/Ventas y cotizaciones.md` |
| Generación de PDFs | `cerebro/Modulos/Envio de documentos.md` |
| Arquitectura técnica | `cerebro/Sistema/Arquitectura.md` |
| Base de datos, tablas | `cerebro/Sistema/Base de datos.md` |
| wa-server | `cerebro/Sistema/wa-server.md` |
| Seguridad, RLS, CSP | `cerebro/Seguridad/Modelo de seguridad.md` |
| Historial de errores | `cerebro/Seguridad/Incidentes.md` |
| Reglas de codificación | `cerebro/Proyecto/Reglas de trabajo.md` |
| Qué falta por hacer | `cerebro/Proyecto/Pendientes.md` |
| Sesiones anteriores | `cerebro/Sesiones/` (ordenadas por fecha) |
