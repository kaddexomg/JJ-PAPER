# 🤖 REGLAS DEL AGENTE — JJ Paper C.A.

> **ESTE ARCHIVO ES OBLIGATORIO.** Todo agente de IA (Antigravity, OpenCode, Claude, Cursor,
> o cualquier otro) DEBE leerlo ANTES de escribir una sola línea de código.
> Última actualización: 2026-09-16

---

## 🧠 Filosofía de Trabajo

### ANTES de tocar código:
1. **Lee el contexto**: `cerebro/INICIO.md` → `cerebro/CONTEXTO.md` → la sesión más reciente en `cerebro/Sesiones/`
2. **Consulta el mapa**: `MAPA_SISTEMA.md` tiene el índice completo de archivos, módulos y tablas
3. **Busca la sección específica** del módulo que vas a tocar en `cerebro/Modulos/`
4. **Lee el código relevante** (solo las funciones que vas a modificar, NO todo el archivo)

### Regla de oro:
> **NO leas todo el código fuente.** El sistema tiene 69 módulos JS + 25 módulos de servidor.
> Usa el cerebro indexado. Lee SOLO lo que necesitas.

---

## ⚠️ PROHIBICIONES ABSOLUTAS

| # | Regla | Por qué |
|---|---|---|
| 1 | **NO toques `wa-server/` sin leer `cerebro/Sistema/wa-server.md`** | Un error criptográfico desvincula WhatsApp y obliga a reescanear QR a 4 personas |
| 2 | **NO modifiques inventario** sin autorización explícita del usuario | Afecta stock real de la empresa |
| 3 | **NO subas datos de negocio a Git** (`.csv`, `.xlsx`, `.pdf`, backups, RIFs, teléfonos) | `.gitignore` los bloquea pero verifica siempre |
| 4 | **NO instales dependencias npm nuevas** sin aprobación | El servidor corre en Windows con RAM limitada |
| 5 | **NO uses `innerHTML` sin `escapeHTML()`** | Riesgo de XSS en el CRM |
| 6 | **NO reescribas archivos completos** | Haz cambios quirúrgicos, función por función |
| 7 | **NO modifiques `assets/js/config.js`** a menos que sea estrictamente necesario | Es el núcleo de enrutamiento multi-proyecto |
| 8 | **NO elimines comentarios ni docstrings existentes** | Preserva la documentación inline |

---

## 🏗️ Metodología de Implementación

### Paso 1: Planificar
```
- Identifica los archivos exactos a modificar
- Lee SOLO las funciones relevantes de esos archivos
- Documenta qué vas a cambiar y por qué ANTES de hacerlo
```

### Paso 2: Implementar
```
- Cambios quirúrgicos: edita funciones específicas, NO reescribas archivos
- Un commit por funcionalidad (no commits gigantes)
- Nombres de variables y funciones en camelCase
- Comentarios y strings de UI en español
- Siempre incrementa la versión query string (?v=...) al editar JS/CSS
```

### Paso 3: Verificar
```
- Si tocaste wa-server/: ejecuta `node src/index.js` y verifica que arranca sin errores
- Si tocaste frontend/: abre la página en el navegador y verifica la consola
- Si tocaste SQL: ejecuta en modo --dry-run antes de aplicar
```

### Paso 4: Documentar
```
- Actualiza cerebro/Sesiones/YYYY-MM-DD.md con los cambios realizados
- Si creaste un módulo nuevo, documéntalo en cerebro/Modulos/
- Haz commit y push a origin main
```

---

## 🌐 Arquitectura de Red (PC de la Empresa)

### Supabase — 3 Proyectos
| Proyecto | ID | Rol | URL |
|---|---|---|---|
| **A (Core)** | `qxgdrfkobbhdzgtoiavv` | Clientes, Productos, Pedidos, Cotizaciones, Inventario | `https://qxgdrfkobbhdzgtoiavv.supabase.co` |
| **B (Comunicación)** | `klcibjwleiqppedefpxw` | WhatsApp, Email, Campañas, Control del Servidor | `https://klcibjwleiqppedefpxw.supabase.co` |
| **C (Storage)** | `nmcamjxhyysmmvgxgabo` | Imágenes de productos (WebP), Comprobantes | `https://nmcamjxhyysmmvgxgabo.supabase.co` |

### Red Local (LAN de la Empresa)
| Máquina | IP | Puertos | Función |
|---|---|---|---|
| **PC Supervisor** (wa-server) | `192.168.0.172` | `8786` (mutex), `8787` (HTTP), `8788` (HTTPS) | Servidor Node.js, WhatsApp, Campañas |
| **PC Facturación MixNet** | `192.168.0.185` | `3000` (HTTP) | Facturador MixNet, archivos DBF |

### MixNet — Archivos de Datos REALES
```
⚠️ IMPORTANTE: La carpeta "codigo fuente de mixnet" (si existe) es una COPIA
del código del software, NO los datos reales. Los datos viven en:

Unidad M: (red SMB/CIFS) → \\192.168.0.185\comp01\
  ├── VICTAINV.DBF     ← Stock en tiempo real
  ├── MXCTAINV.DBF     ← Catálogo maestro de precios
  ├── PED.DBF          ← Encabezados de pedidos facturados
  ├── MXRENPED.DBF     ← Renglones de pedidos
  └── PRESUP.DBF       ← Presupuestos emitidos en caja

Carpetas de intercambio local:
  C:\JJ-PAPER-MIXER\   ← Directorio principal de exportación/importación
  C:\Pedidos JJ\        ← Pedidos exportados desde JJ Paper
  C:\Cotizaciones JJ\   ← Cotizaciones exportadas
```

### Endpoints Locales del Servidor
```
GET http://192.168.0.172:8787/lan/mixnet/status      → Estado del puente
GET http://192.168.0.172:8787/lan/mixnet/pedidos      → Pedidos recientes
GET http://192.168.0.172:8787/lan/mixnet/cotizaciones → Cotizaciones
GET http://192.168.0.172:8787/lan/mixnet/productos    → Catálogo para facturador
GET http://192.168.0.172:8787/lan/monitor             → Salud del servidor
```

---

## 📁 Mapa Rápido de Archivos (Referencia)

### Frontend (Cloudflare Pages)
```
assets/js/config.js          ← Núcleo de configuración (NO TOCAR sin razón)
assets/js/vendedor/pos.js    ← Punto de Venta (42KB, flujo de teclado completo)
assets/js/vendedor/vquotes.js ← Cotizador (30KB, clon parcial de pos.js)
assets/js/vendedor/product-finder.js ← Buscador de productos (selector de precios A/B/C/D)
assets/js/vendedor/campaign-editor.js ← Editor unificado de campañas WA + Email
assets/js/vendedor/cust-autocomplete.js ← Autocompletado de clientes
assets/js/gemini-client.js   ← Cliente IA Gemini (pool 7 keys, Spintax, redacción)
assets/js/doc-engine.js      ← Motor de PDFs (cotizaciones, lista de precios)
assets/js/admin/sidenav.js   ← Navegación admin + paleta Ctrl+K
assets/js/admin/aclients.js  ← CRM de clientes global
assets/js/admin/correo.js    ← Cliente de correo Gmail
```

### Backend (wa-server en PC de oficina)
```
wa-server/src/index.js          ← Punto de entrada, mutex, auto-sanación Bad MAC
wa-server/src/session-manager.js ← Gestor multi-sesión WhatsApp
wa-server/src/wa-session.js     ← Socket Baileys individual
wa-server/src/outbox.js         ← Cola de mensajes salientes
wa-server/src/campaigns.js      ← Motor de difusión masiva WhatsApp
wa-server/src/email-campaigns.js ← Motor de campañas de email
wa-server/src/mixer.js          ← Puente bidireccional con MixNet
wa-server/src/email.js          ← Gmail API OAuth
wa-server/src/heartbeat.js      ← Latido cada 30s a Supabase
wa-server/src/rates.js          ← Tasa BCV/USDT automática
wa-server/src/count-lan.js      ← Servidor LAN de inventario offline
wa-server/src/logger.js         ← Rotación de logs (10MB boot, 50MB runtime)
wa-server/src/monitor.js        ← Telemetría SSE para admin/monitor.html
```

### Base de Datos (Supabase)
```
Tablas Core (Proyecto A):
  jjp_customers        ← Clientes (1,812+)
  jjp_products          ← Productos padre
  jjp_product_variants  ← Variantes con price_a/b/c_bs/d_bs/price_usd
  jjp_orders            ← Pedidos (quote_id, customer_id, items JSONB)
  jjp_quotes            ← Cotizaciones (items JSONB, status)
  jjp_profiles          ← Personal (role: admin/vendedor)
  jjp_settings          ← Config global (tasas, límites diarios)
  jjp_prospects         ← Prospectos B2B (131+ cuentas corporativas)
  jjp_seller_prices     ← Precios personalizados por vendedor

Tablas Comunicación (Proyecto B):
  jjp_wa_sessions       ← Sesiones WhatsApp
  jjp_wa_messages       ← Mensajes (status: pending/sending/sent/failed)
  jjp_wa_chats          ← Conversaciones
  jjp_wa_campaigns      ← Campañas masivas WhatsApp
  jjp_wa_campaign_targets ← Destinatarios de campañas WA
  jjp_email_campaigns   ← Campañas masivas email
  jjp_email_campaign_targets ← Destinatarios de campañas email
  jjp_server_control    ← Heartbeat y comandos remotos
```

---

## 🔌 Guía de Conexión MixNet (para el agente en la PC de oficina)

### Requisitos Previos
1. La PC debe tener mapeada la unidad `M:` apuntando a `\\192.168.0.185\comp01`
2. O la PC MixNet debe tener corriendo `archivos-pc/server.cjs` en el puerto 3000
3. Verificar con: `dir M:\VICTAINV.DBF` o `curl http://192.168.0.185:3000/api/products`

### Configuración (`wa-server/mixnet-config.json`)
```json
{
  "primary_dir": "M:/comp01",
  "drop_dirs": ["C:/JJ-PAPER-MIXER", "C:/Pedidos JJ", "C:/Cotizaciones JJ"],
  "dbf_dir": "M:/comp01",
  "available_drives": ["C:", "M:"]
}
```

### Flujo de Sincronización
```
MixNet → JJ Paper:
  1. mixer.js lee VICTAINV.DBF (o HTTP :3000) cada 5 minutos
  2. Actualiza price_a, price_b, price_usd, price_c_bs, price_d_bs, stock
  3. Si no hay M: ni HTTP, escanea CSVs en drop_dirs

JJ Paper → MixNet:
  1. Cuando se crea un pedido en jjp_orders, mixer.js genera:
     - pedido_[ID].csv (para importación automática)
     - pedido_[ID].txt (comanda para impresión)
  2. Los deposita en todas las drop_dirs activas
  3. La PC MixNet los recoge y factura
```

### Tareas PENDIENTES de Conexión (requieren la PC de oficina)
- [ ] Verificar que `M:` está mapeada o configurar `mixnet-config.json`
- [ ] Eliminar pedido fantasma `MIX-listapreciosrea` de `jjp_orders`
- [ ] Crear `mixnet-bridge.cjs` real (CommonJS puro, Node 13+, 0 deps npm)
- [ ] Renovar tokens OAuth de Andreina, Marianela y Yovanni

---

## 🧹 Archivos para Limpieza (Residuales/Innecesarios)

### En la Raíz (eliminar cuando sea posible)
```
postgres-binaries.zip          ← 26.5 MB, binarios PostgreSQL innecesarios
actualizacion-jjpaper.bundle   ← Bundle Git residual
esquema_original_real.sql       ← Dump fuera de sql/
patch.js, patch_score.js        ← Scripts temporales ya ejecutados
fix-order.cjs                   ← Corrección puntual ya aplicada
scratch_gemini_test.cjs         ← Prueba de API
log.txt, auditoria-productos.txt ← Logs vacíos/viejos
cargar_clientes.mjs             ← Legacy con IDs viejos
```

### En wa-server/ (eliminar cuando sea posible)
```
*.bak                           ← Backups manuales
new log.txt, new logr error.txt ← Logs sueltos
test-*.js, inspect*.cjs         ← Scripts de prueba
pedidos_mixnet_local.csv        ← Contiene pedido fantasma, limpiar
```

---

## 👥 Equipo de Vendedores

| Nombre | Código | Zona | seller_id | Estado |
|---|---|---|---|---|
| Yovanni | 004/006 | Zona 004, 006 | (consultar jjp_profiles) | Activo |
| Marianela | 008 | Zona 008 | `3c9b7ddd-4b98-45c6-a646-5c557a2bc043` | Sin sesión WA |
| Andreina | 014 | Zona 014 | `68c29cd3-760a-4282-8214-4e7c60413ec5` | Sin sesión WA |
| **Keyder Salazar** | Admin | Zona 010, 020 | `bddc57dc-5bf9-4a72-9e1c-751d07b03164` | Activo (admin) |

> **Zona 010 (191 clientes) y Zona 020 (3,474 clientes)** son EXCLUSIVAS de Keyder.
> Invisibles para vendedores regulares en POS, Cotizador y autocompletado.

---

## 📦 Deploy

### Desde Laptop (Antigravity)
```bash
git add -A
git commit -m "descripción del cambio"
git push origin main
# Cloudflare Pages se actualiza automáticamente (frontend)
# wa-server se actualiza al hacer git pull en la PC de oficina
```

### Desde PC Oficina (OpenCode)
```bash
git pull origin main         # Obtener cambios del laptop
# wa-server se reinicia con START-SERVIDOR.bat
# Frontend ya está en Cloudflare Pages
```

### Bundle Offline (si no hay internet en la PC)
```bash
# En laptop: generar bundle
git bundle create update.bundle HEAD~5..HEAD
# Copiar update.bundle a USB → PC oficina
# En PC oficina:
git pull update.bundle main
```
