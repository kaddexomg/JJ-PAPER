# ESTADO DE SESIÓN — SINCRONIZADOR Y PUENTE MIXNET ⇄ JJ PAPER (13-10-2026)

## 📌 1. Situación Actual y Contexto Exacto
- **Objetivo**: Conexión bidireccional limpia, rápida y no invasiva entre JJ Paper (Cloudflare/Supabase) y MixNet ERP (Clipper/dBase en Windows 7 / M:\comp01), con gestión fidedigna de usuarios, permisos, correlativos, cotizaciones y pedidos sin falsos administradores ni duplicados de permisos.
- **Archivos Clave del Módulo**:
  - `puente-win7/server.cjs`: Backend en CommonJS puro (Node.js 13+).
  - `puente-win7/public/index.html`: Frontend interactivo del puente con pestañas de Cotizaciones, Pedidos, Usuarios MixNet, Explorador Multiformato, Backups/Rollback y Agente Ejecutor.
  - `puente-win7.zip`: Paquete listo para desplegar en la PC de tienda.
  - `MAPEO-TOTAL-MIXNET/MAPA_TOTAL_DIRECTORIOS.json` y `.txt`: Mapeo completo de 10,998 archivos de la unidad `M:`, `P:` y discos locales.

---

## 🎯 2. Lo que se Descubrió y Corrigió en Esta Sesión

1. **Estructura Real de Seguridad y Usuarios de MixNet**:
   - MixNet **NO** usa un archivo plano `MXUSUAR.DBF`.
   - La seguridad de MixNet se administra en la raíz `M:\` mediante:
     - `MXSECURI.CFG` (72.6 KB, matriz de permisos de seguridad por módulos).
     - `MXUSER*.EXT` (234 bytes por usuario, ej. `MXUSER01.EXT`, `MXUSER04.EXT`, `MXUSER05.EXT`, etc.).
     - `MXUSER*.MEM` (archivos de memoria de variables).
     - Nómina de vendedores en `M:\comp01\MXCTAVDD.DBF` (30 registros).
   - **Aclaración Crucial del Usuario**:
     - El usuario `005` (José) es Admin en JJ Paper, pero en MixNet **NO es administrador general ni tiene los mismos permisos de Mary García (`001`)**. En MixNet, `005` tiene asignados roles operativos de vendedor/mostrador con ~2 a 3 permisos estándar.
     - Se eliminó la asignación indiscriminada de administrador (`isAdmin` solo para `001`, `010` y `020`), y los permisos por defecto para vendedores regulares se ajustaron a los 3 permisos básicos reales:
       1. `COT_CREAR`: Crear cotizaciones.
       2. `PED_CREAR`: Crear pedidos.
       3. `INV_VER_STOCK`: Consultar existencias e inventario.

2. **Inyección de Cotizaciones y Pedidos a MixNet**:
   - Resuelto el problema de códigos de cliente vacíos o en cero (`00000` / `00`):
     - Ahora el puente consulta `MXCTACLI.DBF` y hace matching por RIF limpio o código de cliente para asignarle su código real en MixNet (ej. `001-096`, `014-522`, etc.).
   - Mapeo completo de renglones en `MXRENCOT` y `MXRENPED` con los tipos dBase III exactos (`ITEM`, `UNIDAD`, `CANTIDAD`, `DESCRIP`, `PRECIO`, `TOT_REN`, `IVA: A`, `ESTATUS: PE`, `EMISION: YYYYMMDD`).

3. **Próximo Correlativo Oficial de MixNet**:
   - `MXNUMCOT.DBF` y `MXNUMPED.DBF` guardan el correlativo en el campo `NUMERO`. Se ajustó `getNextSerial` e `incrementSerial` para leer este campo sin fallar, mostrando el número exacto en las tarjetas superiores (`00053397` cotizaciones, `00112668` pedidos).

4. **Explorador Multiformato**:
   - Ya no se limita a `.DBF`. Permite visualizar e inspeccionar `.INI`, `.PRN`, `.TXT`, `.MEM` y `.CFG`.

---

## 🛠️ 3. Tareas Resueltas en Esta Continuación (Noche 13-10-2026)

1. **Lectura y Deserialización Directa de `MXUSER*.EXT` (234 bytes)**:
   - Implementado en `puente-win7/server.cjs` el escaneo y decodificación de archivos binarios `MXUSER01.EXT` a `MXUSER33.EXT`.
   - Se extrae el login legible de los primeros bytes y se contabilizan los flags nativos activos byte a byte (`'S'`, `'1'`, `0x01`, `'T'`).
   - Se envía `native_flags_count` y el nombre del archivo `.EXT` en `/api/users`.

2. **Refinamiento de Usuarios Activos y Roles Exactos**:
   - `001` (Mary García): Exclusivamente Administradora General (`is_admin: true`).
   - `005` (José): Configurado con rol operativo `Caja / Mostrador`, `is_admin: false`, y estrictamente 3 permisos por defecto (`COT_CREAR`, `PED_CREAR`, `INV_VER_STOCK`).
   - Vendedores de nómina (`002` Luis, `004` Yovanni, `008` Marianela, `014` Andreina) y usuarios mapeados con sus 3 permisos estándar.
   - En la interfaz web (`index.html`), se corrigió el indicador de administrador para que dependa exclusivamente de `is_admin` (evitando que tener permiso de anular marque a alguien con corona 👑 o rol admin). Se añade badge del archivo `.EXT` y contador de flags nativos.

3. **Optimización de Backups y Rollback Integral (`mixnet-backup.cjs`)**:
   - `createPreTransactionSnapshot` ahora incluye automáticamente los archivos de seguridad y usuarios tanto de `M:\comp01` como de la raíz `M:\` (`MXSECURI.CFG`, `MXCLA.MIX`, todos los `MXUSER*.EXT`, y `JJ_USER_PERMISSIONS.json`).
   - `rollbackSnapshot` conserva la ruta original de cada archivo para restaurar tanto en `M:\` como en `comp01` con 100% de precisión.

5. **Inspección de Renglones y Productos en Cotizaciones, Pedidos y Facturas**:
   - Agregado el endpoint `/api/mixnet/documents` que lee directamente desde MixNet `MXENCCOT` + `MXRENCOT`, `MXENCPED` + `MXRENPED` y `MXENCFAC` + `MXRENFAC` indexando y agrupando sus renglones por número de documento.
   - En la interfaz web (`index.html`), se añadió la pestaña `Facturación MixNet` (`tabInvoices` y `viewInvoices`) para auditar las facturas fiscales generadas en tienda.
   - Se incorporó el toggle de origen (`🌐 Nube Web / POS` vs `💾 MixNet DBF`) en Cotizaciones y Pedidos.
   - Implementado el botón `📦 X productos (Ver Renglones)` y el modal `modalItemsDetail` para ver la lista desglosada de productos de cada documento con SKU, nombre, cantidad, unidad (UND/CJA/BLT), precio unitario y subtotal, con opción de inyección directa a MixNet si proviene de la web.

6. **Calibración Visual de Vendedores de Piso vs Calle y Estado de Actividad**:
   - Ajustada la nómina para reflejar los 11 vendedores activos de JJ Paper (identificando piso vs calle: `005` Jose/Caja, `008` Marianela, `014` Andreina, `032`/`033` cajas auxiliares, más `001` Mary García y calle `002`, `004`, `006`, `010`, `020`).
   - La tabla de usuarios en `index.html` ahora muestra las columnas `Ubicación` (`🏢 Piso / Tienda` vs `💼 Calle / Mayor`) y `Estado` (`🟢 Activo` vs `🔴 Inactivo`).

7. **Empaquetado y Verificación**:
   - Verificado con `node -c` tanto en `server.cjs` como en `mixnet-backup.cjs`.
   - Empaquetado en `puente-win7.zip` listo para usar en la PC de tienda.

---

## 🚀 4. Próximo Paso en Vivo (En la PC de Tienda)
- Descomprimir `puente-win7.zip` en la PC con acceso a `M:\` y correr `INICIAR-PUENTE.bat`.
- Probar la inyección de una cotización de prueba desde la web y verificar que MixNet abra el documento de inmediato en caja/facturación sin inconsistencias de correlativo o cliente.
- En la interfaz del puente (`http://localhost:8789`), validar la visualización de renglones tanto de la nube como de las tablas directas de MixNet y comprobar la nómina completa de vendedores activos.
