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

## 🛠️ 3. Tareas Pendientes para Retomar en la Próxima Sesión

1. **Lectura Directa de la Matriz de Flags desde `MXSECURI.CFG` y `MXUSER*.EXT`**:
   - Deserializar la estructura binaria de `MXUSER05.EXT` (234 bytes) y `MXSECURI.CFG` para leer la lista nativa de flags 1 a 1 sin intermediarios.
   - Mostrar en la interfaz del puente los nombres de permisos exactos que MixNet utiliza internamente en sus pantallas Clipper.

2. **Refinamiento de Usuarios Activos en Nómina vs Sistema**:
   - Cargar los 30 registros de `MXCTAVDD.DBF` completos y contrastarlos contra los archivos `MXUSER*.EXT` existentes en `M:\` para listar con precisión cuáles están activos en el software y con qué nombre de cuenta inician sesión.
   - Reflejar con claridad el perfil de José (`005`) con sus permisos reales y permitir la edición granular sin alterar a otros usuarios.

3. **Optimización de Backups y Rollback**:
   - Robustecer `mixnet-backup.cjs` para que los snapshots incluyan tanto las tablas de `M:\comp01` como los archivos de control `MXUSER*.EXT` de la raíz `M:\`.

4. **Prueba en Vivo de Inyección**:
   - Una vez reiniciado el puente en la tienda, probar la inyección de una cotización y un pedido para verificar que en MixNet abra de inmediato en la pantalla de facturación/pedidos.
