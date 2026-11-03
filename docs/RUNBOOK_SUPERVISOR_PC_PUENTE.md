# Runbook Maestro: Puente Bidireccional Soberano (PC Supervisor ⇄ VPS)

> **JJ Paper — Infraestructura LAN Tienda & VPS Central**  
> **Fecha**: Noviembre 2026.  
> **Ubicación en el repositorio**: `docs/RUNBOOK_SUPERVISOR_PC_PUENTE.md`.  
> **Destinatarios**: Administradores de Sistemas, Operadores de Tienda y Agentes de IA.

---

## 1. Arquitectura y Topología del Sistema

```
                      +------------------------------------------+
                      |           VPS SOBERANO UBUNTU            |
                      |              166.0.112.247               |
                      |  PostgreSQL 16 · PostgREST 12 · SSL      |
                      |  Tabla de Tareas: jjp_mixnet_tasks       |
                      |  Control y Latidos: jjp_server_control   |
                      +--------------------+---------------------+
                                           ^
                                           | HTTPS / REST (PostgREST)
                                           v
+--------------------------------------------------------------------------------+
|                   RED LOCAL TIENDA FÍSICA (LAN JJ PAPER)                      |
|                                                                                |
|   +------------------------------------------------------------------------+   |
|   |   PC SUPERVISOR / SERVIDOR CENTRAL MIXNET                              |   |
|   |   • Carpeta Maestra de Datos: M:\MIX11\comp01                          |   |
|   |   • Demonio Guardián: jj-mixnet-agent/agent.js (Node.js 20+)           |   |
|   |   • Script de Arranque Persistente: jj-mixnet-agent/START-AGENT.bat    |   |
|   +-------------------+----------------------------------------------------+   |
|                       |                                                        |
|                       | Compartición de Red SMB (M:\MIX11\comp01)              |
|                       v                                                        |
|   +------------------------------------------------------------------------+   |
|   |   5 COMPUTADORAS DE VENDEDORES EN TIENDA                               |   |
|   |   • Acceden simultáneamente a M:\MIX11\comp01                          |   |
|   |   • Facturan, cotizan y consultan inventario en MixNet Clipper         |   |
|   |   • Ven cotizaciones inyectadas desde la web gracias a índices .NTX    |   |
|   +------------------------------------------------------------------------+   |
+--------------------------------------------------------------------------------+
```

---

## 2. ¿Qué procesos se inician y quedan encendidos 24/7?

En la **PC Supervisor** (en la tienda física), el único proceso maestro que debe mantenerse encendido es:

### `jj-mixnet-agent\START-AGENT.bat`

Este archivo por lotes ejecuta `node agent.js` dentro de un bucle de supervisión (`:LOOP`):
- Si el proceso se detiene o se reinicia por una actualización, el `.bat` espera 5 segundos y lo vuelve a levantar automáticamente.
- Ejecuta `git pull origin main` al arrancar para auto-actualizarse sin intervención manual.

### ¿Qué hace `agent.js` internamente? (4 Bucles Concurrentes)

1. **Bucle de Tareas Agénticas (Cada 3 segundos)**:
   - Consulta `jjp_mixnet_tasks` en PostgreSQL buscando tareas con `status = 'pending'` y `target = 'supervisor'`.
   - Ejecuta de inmediato órdenes interactivas enviadas desde la web:
     - `inject_quote`: Escribe la cotización en `MXENCCOT`/`MXRENCOT` y actualiza índices `.NTX`.
     - `inject_order`: Escribe el pedido en `MXENCPED`/`MXRENPED` y actualiza índices `.NTX`.
     - `reindex_all`: Reconstruye los 10 árboles B-Tree en memoria.
     - `create_backup`: Genera snapshot `.BAK` en `M:\MIX11\comp01\backups\`.
     - `sync_all`: Dispara barrido completo de importación y exportación.

2. **Bucle de Sincronización de Documentos (Cada 10 segundos)**:
   - **MixNet ➔ Web (`importMixnetDocuments`)**:
     - Lee `MXENCCOT.DBF` y `MXENCPED.DBF`.
     - Si los vendedores en las 5 computadoras de la tienda emitieron cotizaciones o ventas, las importa automáticamente a `jjp_quotes` y `jjp_orders`.
   - **Web ➔ MixNet (`exportPendingDocumentsToMixnet`)**:
     - Barre cualquier cotización o pedido en estado `pendiente_mixnet` (generado al presionar el botón `📥 Insertar` en la web).
     - Lo escribe atómicamente en MixNet con formato Clipper legítimo.
     - Asigna el correlativo oficial y actualiza el estado en PostgreSQL a `confirmado_mixnet`.

3. **Bucle de Catálogo e Inventario (Cada 60 segundos)**:
   - Lee `MXCTAINV.DBF` y actualiza existencias, precios y SKU en `jjp_products`.

4. **Bucle de Telemetría y Latido (Cada 15 segundos)**:
   - Lee los correlativos reales en disco (`MXNUMCOT.DBF` y `MXNUMPED.DBF`).
   - Envía el pulso a `jjp_server_control` en el VPS, reportando:
     - `host: "Supervisor-Pc"`
     - `online: true`
     - `current_cot_serial` y `current_ped_serial`
     - `last_sync_at`

---

## 3. Protocolo de Inserción Nativa en MixNet (Reglas de Oro)

Cuando el agente escribe en los archivos DBF de MixNet, se adaptará al formato original respetando las siguientes directivas inviolables:

1. **Comentarios 100% Limpios**:
   - `COMEN1` contiene única y exclusivamente las notas de despacho ingresadas por el vendedor (o espacios `0x20`).
   - Prohibido agregar prefijos técnicos como `[MixNet]`, `COT-` o firmas de agentes.
   - `COMEN2` se preserva limpio.

2. **Códigos de Clientes Legítimos**:
   - Si el cliente existe en `MXCTACLI.DBF` (por RIF o nombre), se utiliza su código oficial (`CODCLI`).
   - Si el cliente es nuevo o no posee ficha previa en MixNet, se utiliza el código estándar del sistema:
     **`000-001`** con razón social **`CUENTA RECUPERADA`**.

3. **Códigos de Vendedor Sagrados (`CODVEN`)**:
   - `002`: Luis Alarcón
   - `004` / `006`: Yovanni Araujo
   - `008`: Marianela
   - `014`: Andreina
   - `005`: Keyder Salazar (Admin / Mostrador)
   - *Nota*: Las carteras 010 y 020 no son códigos de vendedor en MixNet; la autoría la define estrictamente el `CODVEN`.

4. **Artículos Libres o Sin Código**:
   - Si se cotiza un insumo especial que no está en el catálogo, se mapea al código oficial de servicio de MixNet:
     **`IN-OS`** (prohibido usar `'LIBRE'` o códigos inventados).

5. **Compilación Inmediata de Índices B-Tree Clipper (.NTX)**:
   - Cada inserción actualiza de inmediato los archivos `.NTX` en `M:\MIX11\comp01`:
     - Cotizaciones: `MXENCZX1.NTX`, `MXENCZX2.NTX`, `MXENCZX3.NTX`, `MXRECZX1.NTX`, `MXRECZX2.NTX`.
     - Pedidos: `MXENPEX1.NTX`, `MXENPEX2.NTX`, `MXENPEX3.NTX`, `MXREPEX1.NTX`, `MXREPEX2.NTX`.
   - **Resultado**: Las otras 5 computadoras de la tienda ven la cotización en sus pantallas al segundo siguiente, sin bloqueos ni errores de corrupción.

---

## 4. Cómo Poner en Marcha el Demonio en la PC Supervisor

Si la PC Supervisor se reinicia o se inicia por primera vez:

1. Abrir **PowerShell** o **CMD** en la PC Supervisor.
2. Asegurar que la unidad `M:\` esté conectada:
   ```powershell
   Test-Path M:\MIX11\comp01\MXCTAINV.DBF
   # Debe retornar True
   ```
3. Navegar a la carpeta del proyecto y ejecutar:
   ```cmd
   cd C:\Users\PC\Desktop\JJ PAPER\jj-mixnet-agent
   START-AGENT.bat
   ```
4. Para que inicie automáticamente con Windows de forma oculta en segundo plano:
   - Crear un acceso directo a `jj-mixnet-agent\START-AGENT.bat` en la carpeta de inicio de Windows (`shell:startup`).
   - O ejecutar:
     ```powershell
     schtasks /create /tn "JJ_Paper_Mixnet_Daemon" /tr "cmd.exe /c \"C:\Users\PC\Desktop\JJ PAPER\jj-mixnet-agent\START-AGENT.bat\"" /sc onlogon /rl highest
     ```

---

## 5. Verificación de Salud del Puente

Desde cualquier navegador web (o desde la laptop):
1. Ingresar a `https://jjpaper.pages.dev/admin/mixnet.html` o `admin/monitor.html`.
2. Verificar que la tarjeta del **Guardián MixNet** muestre:
   - Estado: `🟢 Guardián MixNet EN LÍNEA`
   - Host: `Supervisor-Pc`
   - Último pulso: Hace menos de 1 minuto.
   - Correlativo de Cotización y Pedido sincronizado con la tienda.
