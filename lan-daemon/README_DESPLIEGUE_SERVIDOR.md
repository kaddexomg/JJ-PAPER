# 🚀 Guía de Despliegue del Demonio de Red MixNet (LAN Daemon)

Este paquete (`lan-daemon`) es un microservicio autónomo diseñado para independizar la sincronización de JJ Paper de cualquier PC de escritorio.

---

## 🎯 ¿Por qué este demonio soluciona el problema de la PC apagada?

Hasta ahora, si la PC de Supervisor se apagaba o desconectaba, el puente dejaba de leer las tablas de MixNet.

Con este demonio tienes **dos formas de despliegue**:

### Opción A (Recomendada): En el Servidor de Red (`192.168.0.185`)
1. Copia la carpeta `lan-daemon` directamente al Servidor donde viven las carpetas de MixNet (por ejemplo en `C:\lan-daemon` o `D:\MIX11\lan-daemon`).
2. Asegúrate de que el servidor tenga instalado **Node.js** (versión 18 o superior).
3. Haz doble clic en `install-service.bat` (o ejecuta `start-daemon.bat`).
4. **Beneficio**:
   - Accede a las tablas DBF de MixNet de forma local en el disco duro (cero latencia de red SMB).
   - **Aunque se apaguen todas las computadoras de la oficina (Supervisor, cajeros, etc.), la sincronización de pedidos y cotizaciones con la web y Supabase sigue activa 24 horas al día, 7 días a la semana.**

### Opción B: En la PC Supervisor (`Supervisor-Pc`)
- Ya viene integrado en la carpeta `C:\Users\Supervisor\.JJ-PAPER\lan-daemon`.
- Para probarlo de forma independiente, ejecuta `start-daemon.bat`.
- Detectará automáticamente la unidad mapeada `M:\MIX11\comp01` o `Z:\comp01`.

---

## 🏛️ Soberanía Absoluta de Correlativos (`MXNUM`)

El demonio respeta estrictamente la regla de numeración:
1. Lee `MXNUMCOT.DBF` y `MXNUMPED.DBF` directamente.
2. Cada vez que JJ Paper crea una cotización o pedido, consume el serial oficial y escribe el siguiente (`VAL + 1`) en la tabla de control.
3. Se actualiza en Supabase `jjp_settings` en tiempo real.
4. **Cero números inventados, cero colisiones.**

---

## 📡 Micro-API Local (Puerto 8790)

El demonio levanta un servidor HTTP local en el puerto `8790` que puede ser consultado por cualquier computadora de la tienda o por el frontend:

- `GET http://192.168.0.185:8790/status`  
  Devuelve el estado en vivo, la ruta activa de MixNet, los seriales actuales de cotización y pedido, y la cantidad de documentos sincronizados.
- `GET http://192.168.0.185:8790/next-serial?type=cotizacion`  
  Devuelve el siguiente serial oficial soberano en formato de 8 dígitos (ej: `00053494`).
- `GET http://192.168.0.185:8790/next-serial?type=pedido`  
  Devuelve el siguiente serial oficial soberano en formato de 8 dígitos (ej: `00112771`).
- `POST http://192.168.0.185:8790/sync-now`  
  Dispara una pasada inmediata de sincronización bidireccional.

---

## 🛡️ Respaldos Automáticos de Seguridad

Cada vez que el demonio inyecta un registro en `MXENCCOT`, `MXRENCOT`, `MXENCPED` o `MXRENPED`, crea automáticamente una copia de seguridad en la subcarpeta `backups/SAFETY_*.DBF` antes de tocar un solo byte.
