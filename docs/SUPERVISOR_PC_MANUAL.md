# Manual Maestro y Protocolo Operativo del Entorno Agéntico (Supervisor-PC)

> **JJ Paper — Infraestructura Soberana LAN & VPS**  
> **Última actualización**: Noviembre 2026.  
> **Destinatarios**: Agentes de IA (OpenCode, Claude, Gemini, Antigravity) y Administradores de Sistemas.  
> **Ubicación en el repositorio**: `docs/SUPERVISOR_PC_MANUAL.md`.

---

## 1. Identidad y Arquitectura de la PC Supervisor

La **PC Supervisor** es la estación de trabajo física situada en la tienda central de JJ Paper que actúa como **puente de mando e interfaz agéntica** entre la red local (LAN) y la infraestructura central en el VPS Ubuntu.

```
                           +----------------------------------------+
                           |           VPS SOBERANO UBUNTU          |
                           |             166.0.112.247              |
                           |   PostgreSQL 16 · PostgREST 12 · SSL   |
                           |        Tabla: jjp_mixnet_tasks         |
                           +-------------------+--------------------+
                                               ^
                                               | HTTPS Polling
                                               v
+----------------------------------------------+--------------------+
|                  RED LOCAL TIENDA FÍSICA (LAN JJ PAPER)           |
|                                                                   |
|   +------------------------------------+                          |
|   |   SERVIDOR CENTRAL MIXNET ERP      |                          |
|   |         192.168.0.185:8790         |                          |
|   |   Ruta compartida: M:\MIX11\comp01 |                          |
|   |   Tablas DBF + Índices .NTX        |                          |
|   +-----------------+------------------+                          |
|                     ^                                             |
|                     | SMB / Red Local (M:\)                       |
|                     v                                             |
|   +-----------------+------------------------------------------+  |
|   |   PC SUPERVISOR (Windows 10/11 · Node.js 20+ · Python 3)   |  |
|   |   Ruta: C:\Users\PC\Desktop\JJ PAPER                       |  |
|   |                                                            |  |
|   |   • OpenCode Runner: jj-mixnet-agent/task-runner.js        |  |
|   |   • WhatsApp Server: wa-server/ (Baileys + Outbox)         |  |
|   |   • Sincronizador de Tasas BCV: wa-server/src/rates.js     |  |
|   |   • Ejecutor persistente: wa-server/start-hidden.vbs       |  |
|   +------------------------------------------------------------+  |
+-------------------------------------------------------------------+
```

### Especificaciones del Nodo Supervisor
- **Sistema Operativo**: Windows 10/11 Pro (64-bit).
- **Ruta de Trabajo**: `C:\Users\PC\Desktop\JJ PAPER`.
- **Ruta de Datos ERP**: `M:\MIX11\comp01` (montada vía SMB sobre `\\192.168.0.185\MIX11\comp01`).
- **Motores de Ejecución**:
  - Node.js `v20+` (ejecuta el runner y WhatsApp Baileys).
  - Python `3.10+` (ejecuta scripts analíticos, cálculo de márgenes y exportadores DBF).
  - PowerShell `5.1` o `7.x` (ejecuta comandos de sistema, comprobación de red y diagnóstico).

---

## 2. Componentes y Servicios en la PC Supervisor

### 2.1. OpenCode Agent Runner (`jj-mixnet-agent/task-runner.js`)
Es el micro-agente local que sondea periódicamente la tabla `jjp_mixnet_tasks` en PostgreSQL del VPS.

- **Filtrado de Destino**:
  ```javascript
  // Si la tarea es exclusiva para el VPS, la PC Supervisor la ignora
  if (task.payload?.target && task.payload.target !== 'supervisor' && task.payload.target !== 'all') {
    return;
  }
  ```
- **Capacidades Agénticas Soportadas**:
  1. `exec_cmd` / `run_command`: Ejecuta cualquier instrucción nativa en PowerShell / CMD con timeout y reporte de `stdout`/`stderr`.
  2. `exec_python`: Ejecuta código Python dinámico escribiendo un script temporal en scratch y retornando el resultado.
  3. `exec_node`: Ejecuta scripts JavaScript bajo Node.js.
  4. `read_file`: Lee archivos locales o de la unidad `M:\`.
  5. `patch_file`: Aplica parches seguros con respaldo previo `.bak` y validación de sintaxis (`node -c` o `python -m py_compile`).
  6. `git_pull`: Descarga los últimos cambios del repositorio `main` en GitHub.

### 2.2. Servidor WhatsApp y Outbox (`wa-server/`)
- Mantiene las sesiones multi-agente con Baileys.
- Escucha en el puerto LAN `8787` (API de mensajería) y `8788` (conteo de inventario WiFi).
- Ejecuta `rates.js` para actualizar automáticamente la Tasa Oficial BCV.

---

## 3. Protocolo de Comunicación para Otros Agentes de IA

Cualquier agente de IA (desde el VPS, consola web o subagente) que desee ejecutar comandos o código en la PC Supervisor debe insertar una fila en la tabla `jjp_mixnet_tasks` de PostgreSQL:

### Formato de Despacho de Tarea
```sql
INSERT INTO jjp_mixnet_tasks (task_type, status, payload, created_at)
VALUES (
  'run_command',
  'pending',
  '{
    "action": "run_command",
    "target": "supervisor",
    "command": "powershell -Command \"Get-ChildItem M:\\MIX11\\comp01\\MX*.DBF | Select-Object Name, Length, LastWriteTime\""
  }'::jsonb,
  NOW()
);
```

### Ciclo de Vida de la Tarea:
1. `pending`: El registro está en cola en el VPS.
2. `running`: El `task-runner.js` de la PC Supervisor reclama la tarea atómicamente y actualiza `started_at`.
3. `completed` / `failed`: Tras la ejecución, se actualiza el registro con:
   ```json
   {
     "status": "completed",
     "result": {
       "stdout": "... salida del comando ...",
       "stderr": "",
       "exitCode": 0,
       "completed_at": "2026-11-02T19:00:00Z"
     }
   }
   ```

### Formato para Ejecutar Python en la PC Supervisor:
```json
{
  "action": "exec_python",
  "target": "supervisor",
  "code": "import os\nfiles = [f for f in os.listdir('M:/MIX11/comp01') if f.endswith('.DBF')]\nprint(f'Total DBFs encontrados: {len(files)}')"
}
```

---

## 4. Guía de Instalación y Puesta en Marcha en la PC Supervisor

### Paso 1: Clonación y Dependencias
```powershell
cd C:\Users\PC\Desktop
git clone https://github.com/kaddexomg/JJ-PAPER.git
cd "JJ PAPER"
npm install
cd wa-server
npm install
cd ..
```

### Paso 2: Conexión Persistente de la Unidad de Red M:
Es mandatorio que la unidad `M:` esté mapeada permanentemente:
```powershell
net use M: \\192.168.0.185\MIX11\comp01 /persistent:yes
```
*Comprobación de lectura:*
```powershell
Test-Path M:\MIX11\comp01\MXCTAINV.DBF
# Debe retornar True
```

### Paso 3: Configurar Persistencia 24/7 (Arranque con Windows)
Para que el agente y el servidor WhatsApp funcionen siempre en segundo plano, sin requerir una ventana CMD abierta:
1. Presiona `Win + R`, escribe `shell:startup` y presiona Enter.
2. Crea un acceso directo al archivo:
   `C:\Users\PC\Desktop\JJ PAPER\wa-server\start-hidden.vbs`
3. Alternativamente, registra una tarea programada en Windows:
   ```powershell
   schtasks /create /tn "JJ_Paper_Supervisor_Agent" /tr "wscript.exe \"C:\Users\PC\Desktop\JJ PAPER\wa-server\start-hidden.vbs\"" /sc onlogon /rl highest
   ```

---

## 5. Reglas Sagradas de Negocio en la PC Supervisor

1. **Cero Escritura Directa sin Clic Humano**:
   - Los pedidos y cotizaciones generados en el panel web de JJ Paper **NUNCA** se inyectan a MixNet automáticamente en segundo plano.
   - Solo se escriben en los DBF cuando el usuario presiona expresamente el botón `📥 Insertar` en la interfaz.

2. **Índices Clipper .NTX Obligatorios**:
   - Prohibido modificar o agregar filas en `MXENCPED.DBF`, `MXRENPED.DBF`, `MXENCCOT.DBF` o `MXRENCOT.DBF` mediante herramientas genéricas sin regenerar o actualizar en tiempo real los árboles B-Tree `.NTX`.
   - Ignorar esto bloquea las pantallas de venta en la caja de la tienda.

3. **Respaldo Preventivo `.BAK`**:
   - Todo script por lotes que toque tablas en `M:\` debe generar un duplicado previo en `M:\MIX11\comp01\backups\archivo_TIMESTAMP.BAK`.

4. **Identificadores Sagrados**:
   - Cliente sin registrar en MixNet: Únicamente código `000-001` con nombre `CUENTA RECUPERADA`. Prohibido inventar códigos ficticios.
   - Producto libre o no codificado: Mapear a `IN-OS` (servicios / no inventariado). **NUNCA** usar `'LIBRE'` como SKU.

5. **Nómina y Cartera 010 y 020**:
   - **Cartera 020**: Es **100% artificial**. No pertenece a Keyder Salazar (`005`). No asignar ventas ni clientes de esta zona.
   - **Cartera 010**: Es **histórica**. Solo se atribuyen ventas a Keyder si el documento original en MixNet fue emitido con su código oficial `CODVEN = '005'`.

---

## 6. Comandos de Diagnóstico y Chequeo Rápido

Ejecutar desde PowerShell en la PC Supervisor:

```powershell
# 1. Comprobar conectividad con el VPS Ubuntu
curl.exe -s https://166-0-112-247.sslip.io/auth/v1/telemetry

# 2. Comprobar estado de la unidad M:
Test-Path M:\MIX11\comp01\MXCTAINV.DBF

# 3. Comprobar que el proceso de Node está activo
Get-Process -Name node

# 4. Actualizar repositorio a la última versión
git pull origin main

# 5. Probar sintaxis de scripts locales
node -c jj-mixnet-agent/task-runner.js
node -c wa-server/src/index.js
```
