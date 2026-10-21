# Puente Soberano MixNet ERP (Demonio Autónomo de Red)

> **Documento del Cerebro de JJ Paper**  
> **Fecha de Actualización:** 21 de Octubre de 2026  
> **Ubicación del Código:** `M:\jj-mixnet-agent\` (Servidor Central `192.168.0.185`)  
> **Puerto Micro-API:** `8790` (LAN)  
> **Principio Rector:** **Soberanía dBase III / Clipper**. JJ Paper se ajusta al formato de MixNet; MixNet nunca es forzado a cambiar su estructura.

---

## 1. Por Qué el Agente Reside en el Servidor Central

Anteriormente, el script de sincronización se ejecutaba en la estación de trabajo `SUPERVISOR-PC` (`192.168.0.172`). Cuando el usuario apagaba su equipo, cerraba la consola o la PC se reiniciaba, el puente moría, dejando los precios desactualizados y los pedidos web estancados sin entrar a GemixNet.

### Solución Definitiva:
1. El demonio autónomo se copió a [`M:\jj-mixnet-agent\`](file:///M:/jj-mixnet-agent/).
2. Al estar en `M:\` (que es el disco compartido `D:\` del Servidor `192.168.0.185`), el código se ejecuta en el hardware permanente de la empresa.
3. Se creó el script [`INSTALL-SERVER-SERVICE.bat`](file:///M:/jj-mixnet-agent/INSTALL-SERVER-SERVICE.bat), que lo registra como una **Tarea Programada de Windows al encender el sistema (`ONSTART` / `SYSTEM`)**.
4. Ahora, cualquier PC de la tienda (incluyendo la del supervisor) puede apagarse por completo: **el puente sigue corriendo 24/7 en el servidor central**.

---

## 2. Anatomía de Registros Nativos: Cero Inyecciones Sintéticas

Uno de los mayores causantes de corrupción histórica fue la inyección de comentarios sintéticos como `[MixNet Caja]` o campos inventados con caracteres especiales en tablas que Clipper 5.x procesa de forma estricta.

### Estructura Canónica de Cabeceras (`MXENCCOT` y `MXENCPED`):

```
+------------+-------------+----------+------------+------------+---------+--------+--------+
|   CAMPO    | TIPO DBASE  | LONGITUD | COTIZACIÓN |   PEDIDO   | VALOR   | REGLA  | COMENT |
+------------+-------------+----------+------------+------------+---------+--------+--------+
| NUMCOT     | Carácter    |    8     | 00053535   | —          | Pad L 8 | Estric | Sin #  |
| NUMPED     | Carácter    |    8     | —          | 00112808   | Pad L 8 | Estric | Sin #  |
| FECHA      | Fecha       |    8     | YYYYMMDD   | YYYYMMDD   | Nativo  | Clipper| Sin -  |
| EMISION    | Fecha       |    8     | YYYYMMDD   | YYYYMMDD   | Nativo  | Clipper| Sin -  |
| CLIENTE    | Carácter    |    7     | 006-309    | 006-309    | CODCLI  | Mayúsc | Valid  |
| NOMBRE     | Carácter    |   40     | Razón Soc. | Razón Soc. | Mayúsc  | Trim   | Sin '  |
| RIF        | Carácter    |   15     | J-12345678 | J-12345678 | SENIAT  | Normal | Valid  |
| MONEDA     | Carácter    |    4     | US$        | US$        | US$     | Fijo   | Exacto |
| CAMBIO     | Numérico    |   12,2   | 42.50      | 42.50      | Tasa    | BCV    | Float  |
| CODVEN     | Carácter    |    3     | 008        | 008        | 3 Díg   | Mapeo  | Oficial|
| ESTATUS    | Carácter    |    2     | PE         | PE / OK    | Estado  | Fijo   | Sin esp|
| COMEN1     | Carácter    |   50     | ""         | ""         | Vacío   | NUNCA  | Limpio |
+------------+-------------+----------+------------+------------+---------+--------+--------+
```

> [!CAUTION]
> El campo `COMEN1` debe mantenerse limpio (`""`) o con la observación comercial legítima del cliente. Queda estrictamente prohibido colocar comentarios de depuración, marcas de sincronización o prefijos ajenos al cajero.

---

## 3. Manejo Atómico de Correlativos (`MXNUMCOT` & `MXNUMPED`)

MixNet ERP utiliza archivos `.DBF` de un solo registro para almacenar el último número correlativo emitido:
* `MXNUMCOT.DBF`: Almacena el campo `NUMERO` (8 caracteres, ej. `00053535`).
* `MXNUMPED.DBF`: Almacena el campo `NUMERO` (8 caracteres, ej. `00112808`).

### Procedimiento Atómico de Reserva:
1. Abrir `MXNUMCOT.DBF` con bloqueo de registro.
2. Leer el string de 8 caracteres y convertirlo a entero (`53535`).
3. Asignar `53535` a la nueva cotización.
4. Incrementar a `53536` y escribir el string formateado con relleno de ceros (`00053536`).
5. Grabar inmediatamente en disco (`fsync`) y liberar el bloqueo.
6. Compilar los 10 índices `.NTX`.

---

## 4. Endpoints de la Micro-API del Agente (`http://192.168.0.185:8790`)

El demonio expone una Micro-API HTTP local ultrarrápida:

* `GET /status`: Devuelve uptime, correlativos actuales, directorio maestro activo y estadísticas.
* `GET /sync-now`: Dispara un ciclo inmediato de sincronización bidireccional.
* `POST /backup`: Crea un snapshot de todas las tablas críticas con firma SHA-256 en `M:\MIX11\comp01\backups\`.
* `POST /rollback`: Restaura un snapshot previo y recompila los 10 índices Clipper en memoria.
* `POST /reindex`: Fuerza la reconstrucción completa de los 10 archivos `.NTX`.
* `POST /clients/reconcile`: Cruza la cartera de clientes de MixNet con la web y normaliza RIFs al formato SENIAT.
