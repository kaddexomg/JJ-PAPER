---
skill: clickhouse-io
idioma_original: en
---

# clickhouse-io

Este skill reúne patrones y buenas prácticas para trabajar con ClickHouse, una base de datos columnar orientada a procesamiento analítico (OLAP), optimizada para consultas rápidas sobre grandes volúmenes de datos. Sirve como referencia técnica para diseñar esquemas, escribir consultas analíticas eficientes, optimizar rendimiento e ingerir datos a gran escala en cargas de trabajo analíticas de alto rendimiento.

Se activa cuando la tarea implica: diseñar tablas ClickHouse (elegir motor de tipo MergeTree), escribir consultas analíticas (agregaciones, funciones de ventana, joins), optimizar rendimiento de queries (partition pruning, projections, materialized views), ingerir grandes volúmenes de datos (inserciones batch, integración con Kafka), migrar de PostgreSQL/MySQL a ClickHouse para analítica, o implementar dashboards en tiempo real y analítica de series temporales.

Características clave de ClickHouse destacadas: almacenamiento orientado a columnas, compresión de datos, ejecución paralela de consultas, consultas distribuidas y analítica en tiempo real.

En cuanto a diseño de tablas, el skill documenta tres motores principales de la familia MergeTree, con ejemplos SQL concretos:
- MergeTree (el más común), particionado por mes (toYYYYMM) y ordenado por columnas clave, con index_granularity configurable.
- ReplacingMergeTree, para deduplicar datos que llegan de múltiples fuentes.
- AggregatingMergeTree, para mantener métricas pre-agregadas usando AggregateFunction y funciones *Merge (sumMerge, countMerge, uniqMerge) al consultar.

Sobre optimización de consultas, plantea patrones "PASS/FAIL": filtrar primero por columnas indexadas (en vez de columnas no indexadas como LIKE sobre texto), usar funciones de agregación propias de ClickHouse (uniq, quantile en vez de percentile por ser más eficiente), y funciones de ventana (window functions) para totales acumulados.

Para inserción de datos, recomienda inserciones batch/bulk (agrupando múltiples filas en un solo INSERT) marcándolas como buena práctica, y explícitamente desaconseja insertar registros uno por uno en un loop por ser lento. También muestra un patrón de streaming insert para ingesta continua usando streams de Node.js.

Incluye vistas materializadas (materialized views) para agregaciones en tiempo real, mostrando cómo crear una MV que alimenta una tabla de estadísticas horarias usando funciones de estado (sumState, countState, uniqState) y cómo consultarla luego con las funciones *Merge correspondientes.

Cubre monitoreo de performance: consultas al system.query_log para detectar queries lentas (duración > 1000ms en la última hora) y a system.parts para ver tamaño de tablas y filas usando formatReadableSize.

Presenta ejemplos de consultas analíticas comunes: análisis de series temporales (usuarios activos diarios), análisis de retención (day 0/1/7/30), análisis de embudo/funnel de conversión (viewed → clicked → completed con tasas de conversión) y análisis de cohortes por mes de registro.

En patrones de pipeline de datos, describe un patrón ETL (extract-transform-load) periódico desde PostgreSQL hacia ClickHouse con setInterval, y un patrón de Change Data Capture (CDC) que escucha notificaciones LISTEN/NOTIFY de PostgreSQL y sincroniza los cambios (INSERT/UPDATE/DELETE) hacia ClickHouse en tiempo real.

Finalmente, resume buenas prácticas generales en cinco puntos: (1) estrategia de particionado por tiempo (mes o día, evitando demasiadas particiones, usando tipo DATE), (2) definir bien la clave de ordenamiento (columnas más filtradas primero, considerar cardinalidad, impacto en compresión), (3) usar los tipos de datos más chicos posibles (UInt32 vs UInt64, LowCardinality para strings repetidos, Enum para categóricos), (4) evitar SELECT *, el modificador FINAL, demasiados JOINs y inserciones pequeñas y frecuentes, y (5) monitorear performance de queries, uso de disco, operaciones de merge y el log de queries lentas. El mensaje de cierre resume la filosofía del skill: diseñar las tablas según los patrones de consulta, insertar en batch y aprovechar las vistas materializadas para agregaciones en tiempo real.
