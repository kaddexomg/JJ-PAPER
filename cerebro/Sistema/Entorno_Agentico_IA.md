# Entorno Agéntico IA (Gemini AI Suite & Copiloto)

> **Documento del Cerebro de JJ Paper**  
> **Fecha de Actualización:** 21 de Octubre de 2026  
> **Módulo:** `assets/js/gemini-client.js`  
> **Integración:** `admin/mixnet.html` y `admin/monitor.html`  
> **Objetivo:** Dotar a la administración de un copiloto agéntico autónomo que permita auditar salud, crear snapshots atómicos, ejecutar rollbacks en 1 clic y analizar código o consultas SQL.

---

## 1. Pool Balanceado de 7 API Keys

Para evitar bloqueos por cuota o latencias en horarios pico, el cliente `GeminiClient` implementa una rotación inteligente de 7 API Keys oficiales con reintento automático y conmutación por fallo:

```javascript
const GEMINI_KEYS = [
  'AIzaSyAMnb_StjFGymJtvytbwRI4EWZk1ZL6-Kw', // Key Pro 1
  'AIzaSyABK4eanXioE1kJmRMhJ14AqosSNJ5cz_E', // Key Pro 2
  'AQ.Ab8RN6IsSWjE9mHK9IRjNyauqgMLHLWLCJnwiEHU7Uo6sC0cNA',
  'AQ.Ab8RN6LOFt4ga-GPIkdVcDya_L2DSSrfqWTyPK3QSzM1e5pVfQ',
  'AQ.Ab8RN6I3nhWx1f54n5rcLa1nJv238N-IqJoIRWljUjZmg3nl-Q',
  'AQ.Ab8RN6K7DB2-YqkZma3jsV8EfCqHel0UnR07oY-r8qquxgKTsA',
  'AQ.Ab8RN6L0PS4XofEO8X9lbsE8P1sYD6jqItzCRvb0QbX1KvdEOw'
];
```

### Modelos y Estrategia de Inferencia:
* **Modelo Arquitectónico:** `gemini-3.8-flash` / `gemini-2.5-flash` para auditorías técnicas complejas, diagnóstico de índices y sugerencias de código.
* **Modelo Rápido:** Inferencia en <400 ms para sugerencias comerciales en vivo y respuestas de cotización.

---

## 2. Capacidades Agénticas Autónomas

El Entorno Agéntico no es un simple chat; es un sistema con capacidad de ejecución de tareas críticas en el servidor mediante el encolamiento de órdenes en `public.jjp_mixnet_tasks` y llamadas a la Micro-API `:8790`:

### A. Diagnóstico Integral (4 Pasos)
1. **VPS:** Verifica disponibilidad de PostgREST, tamaño de base de datos (`jjpaper_db`), tuplas muertas y consumo de RAM/Disco.
2. **Puente LAN:** Valida respuesta del puerto 8790 en el servidor `192.168.0.185` y coherencia de los correlativos `MXNUMCOT` y `MXNUMPED`.
3. **Índices Clipper:** Audita la integridad de los 10 archivos `.NTX`.
4. **Veredicto:** Presenta al usuario un resumen ejecutivo con acciones correctivas recomendadas.

### B. Snapshots Preventivos Atómicos en 1-Clic
* **Ruta de Almacenamiento:** `M:\MIX11\comp01\backups\` (en el servidor físico).
* **Archivos Resguardados:**
  * `MXNUMCOT.DBF`, `MXNUMPED.DBF`
  * `MXCTACLI.DBF`, `MXCTAINV.DBF`
  * `MXENCCOT.DBF`, `MXRENCOT.DBF`
  * `MXENCPED.DBF`, `MXRENPED.DBF`
  * Los 10 archivos `.NTX` de índices.
* **Firma de Seguridad:** Cálculo de hash SHA-256 por archivo para garantizar que ningún snapshot esté corrupto antes de permitir su restauración.

### C. Rollback Inmediato a Snapshot Previo
* En caso de una modificación errónea o contingencia en el ERP, el supervisor selecciona el snapshot deseado en la lista histórica.
* El sistema sobreescribe las tablas maestras al estado exacto del snapshot y compila automáticamente los índices `.NTX`.
* Los documentos creados en la web posteriores a esa fecha se re-sincronizan ordenadamente sin duplicación.

### D. Reindexación en Memoria B-Tree
* Reconstrucción atómica de los 10 índices Clipper en <150 ms sin requerir el cierre de terminales de facturación de la tienda.

### E. Conciliación Inteligente de Clientes
* Cruce algorítmico entre clientes registrados en la web (`jjp_customers`) y clientes del ERP (`MXCTACLI.DBF`).
* Normalización automática de RIFs numéricos al formato SENIAT (`J-12345678-0`).
* Asignación de código MixNet de 6 dígitos para aquellos clientes que no contaban con correlativo.
