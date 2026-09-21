---
skill: cost-tracking
idioma_original: en
---

# cost-tracking

Este skill sirve para analizar el historial de costos y uso de Claude Code a partir del log de métricas local que genera el hook `stop:cost-tracker` de ECC. Se activa cuando el usuario pregunta cuánto gastó, cuál fue el costo de una sesión, cuál es su uso de tokens, o cuando menciona presupuestos, límites de gasto, excesos o desgloses de costo por modelo, sesión o fecha.

Los datos viven en `~/.claude/metrics/costs.jsonl`, donde el tracker agrega un objeto JSON por cada finalización de sesión ("session-stop"). Un punto clave del funcionamiento es que cada fila es un snapshot ACUMULATIVO de esa sesión, no un incremento: para totalizar el gasto hay que quedarse con la ÚLTIMA fila de cada `session_id` y sumar entre sesiones. Sumar todas las filas sin filtrar duplica el conteo, y esto se marca explícitamente como un anti-patrón a evitar.

El esquema de cada fila incluye: `timestamp` (marca de tiempo ISO), `session_id` (identificador de sesión), `transcript_path` (ruta al transcript), `model` (modelo usado), `input_tokens`/`output_tokens` (conteo de tokens), `cache_write_tokens`/`cache_read_tokens` (tokens de caché de prompt) y `estimated_cost_usd` (costo acumulado estimado en USD, ya precalculado). El skill indica preferir siempre este campo `estimated_cost_usd` antes que calcular el precio a mano, porque los precios de modelos y de caché cambian y el tracker es la fuente de verdad.

El flujo de trabajo es: primero verificar que el log exista, usando `node` (no `sqlite3`, ya que el tracker escribe JSONL y `node` es multiplataforma) con un one-liner que chequea la existencia del archivo con `fs.existsSync`. Si el log no existe, la instrucción explícita es NO inventar datos de uso, sino avisarle al usuario que el tracking de costos empieza a poblarse recién después de que termine la primera sesión con el hook `stop:cost-tracker` habilitado.

Se incluye un ejemplo de script en Node que arma un resumen: agrupa filas por `session_id` quedándose con la más reciente, calcula el gasto de hoy vs. ayer, el total acumulado y el número de sesiones, y además desglosa el costo por modelo ordenado de mayor a menor. Para un drilldown por sesión o una exportación a CSV, sugiere iterar sobre ese mismo conjunto de "últimas filas" (o sobre las filas crudas para CSV) imprimiendo los campos necesarios.

En cuanto al formato de reporte, cuando se presentan datos de costo hay que incluir: gasto de hoy vs. ayer, total across todas las sesiones, desglose por modelo y cantidad de sesiones. Los montos menores a un dólar se formatean con cuatro decimales, y los montos mayores con dos decimales.

Los anti-patrones que el skill señala explícitamente son: no sumar todas las filas sin deduplicar por sesión; no estimar costos a partir de conteos de tokens crudos cuando ya existe `estimated_cost_usd`; no asumir que el log existe sin comprobarlo antes; no hardcodear precios de modelos vigentes en las respuestas al usuario; y no recomendar instalar hooks o plugins sin revisar que ejecuten código arbitrario.

Finalmente, el skill enlaza con recursos relacionados: el comando `/cost-report` (una versión en forma de comando sobre el mismo log de métricas), el skill `cost-aware-llm-pipeline` (patrones de ruteo de modelos y diseño de presupuestos), `token-budget-advisor` (planificación de presupuesto de contexto y tokens) y `strategic-compact` (compactación de contexto para reducir gasto repetido de tokens).
