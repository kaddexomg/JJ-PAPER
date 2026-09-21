---
skill: data-throughput-accelerator
idioma_original: en
---

# data-throughput-accelerator

Este skill se activa cuando el cuello de botella de una tarea es mover, transformar o guardar grandes volúmenes de datos: ingestas masivas, backfills, exports, procesos ETL, cargas a un data warehouse, catch-up de manifiestos o sincronización de tablas. Su objetivo no es simplemente "ir más rápido", sino lograr que los datos correctos lleguen más rápido al lugar correcto y con evidencia verificable de que quedaron bien.

Antes de optimizar nada, propone separar claramente distintas fuentes de lentitud, porque optimizar una no implica resolver las demás: velocidad de extracción en el origen, velocidad de transferencia por red, velocidad de carga al warehouse, velocidad de transformación, frescura de las tablas de servicio, y el crecimiento del "tail" en vivo mientras el job corre. Señala una advertencia importante: un pipeline puede ser objetivamente "rápido" y aun así parecer atrasado si llegan datos nuevos más rápido de lo que dura la ventana final de catch-up.

En cuanto a heurísticas de camino rápido, recomienda: mover el cómputo hacia donde ya están los datos (en vez de traer los datos hacia el cómputo); preferir escaneos, joins y appends nativos del warehouse para archivos grandes ya aterrizados; usar manifiestos o checkpoints para saltear archivos o particiones ya completados; alinear particionado y clustering con el patrón real de lectura/escritura; agrupar en batches los archivos, requests y writes pequeños; garantizar que las escrituras sean idempotentes (vía claves únicas, manifiestos o staging reemplazable); y mantener separadas y auditables las tablas raw, derivadas y de serving.

El workflow que propone tiene siete pasos: 1) leer los contratos actuales de fuente, destino y manifiesto; 2) medir el backlog (archivos externos, filas de manifiesto, filas raw, filas derivadas, timestamps mínimo/máximo y conteos sin procesar); 3) correr un catch-up seguro o un benchmark de muestra; 4) comparar variantes (tamaño de batch, cantidad de workers, SQL del warehouse, agrupamiento de archivos, forma del staging, método de actualización del manifiesto); 5) promover solo el camino más rápido que mantenga coherentes los conteos y timestamps; 6) codificar ese camino como CLI, job programado, workflow o runbook; y 7) volver a correr la contabilidad final después de ejecutar el camino ya codificado.

Como salida, exige un bloque de "accounting" (contabilidad) con formato fijo en texto plano que reporte, por ejemplo: archivos fuente descubiertos, archivos procesados en la corrida, filas raw agregadas, filas derivadas agregadas, tail remanente al momento de la lectura, runtime total, y un "correctness gate" que confirme que los conteos del manifiesto y los timestamps máximos de las tablas coinciden.

Finalmente, define guardrails estrictos: no borrar datos raw para maquillar una métrica; no saltear archivos fallidos en silencio; no mezclar el estado de un backfill histórico con la frescura del tail en vivo; no dar un pipeline por completo hasta que las tablas destino y el manifiesto coincidan; y en datos de finanzas, salud, sectores regulados o que impactan directamente al cliente, preservar evidencia de replay y los gates de aprobación correspondientes.

El skill declara acceso a las herramientas Read, Write, Edit, Bash, Grep y Glob, y proviene del catálogo ECC (origin: ECC).
