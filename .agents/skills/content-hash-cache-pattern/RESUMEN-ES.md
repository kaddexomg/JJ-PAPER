---
skill: content-hash-cache-pattern
idioma_original: en
---

# content-hash-cache-pattern

Este skill define un patrón para cachear resultados de procesamiento de archivos costosos (por ejemplo, parseo de PDF, extracción de texto, análisis de imágenes) usando hashes SHA-256 del contenido del archivo como clave de caché. A diferencia de un caché basado en la ruta del archivo, este enfoque es independiente de la ruta: sobrevive a movimientos o renombrados de archivos, y se auto-invalida automáticamente cuando el contenido cambia.

Cuándo conviene activarlo: al construir pipelines de procesamiento de archivos (PDF, imágenes, extracción de texto), cuando el costo de procesamiento es alto y los mismos archivos se procesan repetidamente, cuando se necesita una opción de CLI tipo `--cache/--no-cache`, o cuando se quiere agregar caching a funciones puras existentes sin modificarlas.

El patrón central consta de cuatro piezas:
1. **Clave de caché basada en hash de contenido**: se calcula un SHA-256 del contenido del archivo (leyendo en chunks de 64KB para no cargar archivos grandes en memoria completos). El renombrado o movimiento del archivo produce un cache hit; un cambio de contenido invalida automáticamente el caché, sin necesidad de un archivo índice.
2. **Dataclass congelada (frozen) para la entrada de caché**: una `CacheEntry` inmutable (`frozen=True, slots=True`) que guarda el hash, la ruta de origen y el resultado (documento) cacheado.
3. **Almacenamiento basado en archivos**: cada entrada se guarda como `{hash}.json`, lo que permite búsqueda O(1) por hash sin necesidad de índice. Incluye funciones `write_cache` y `read_cache`; la lectura maneja corrupción (JSON inválido, claves faltantes) devolviendo `None`, tratándolo como un cache miss en vez de fallar.
4. **Capa de servicio (wrapper) separada**: la función de procesamiento (por ejemplo `extract_text`) se mantiene pura y sin conocimiento del caching. Una función separada (`extract_with_cache`) orquesta: si el caching está deshabilitado, llama directo a la función pura; si está habilitado, calcula el hash, revisa el caché, y en caso de miss ejecuta la extracción y guarda el resultado. Se recomienda loguear hits y misses con el hash truncado para debugging.

Decisiones de diseño clave documentadas en una tabla: usar SHA-256 de contenido (independiente de ruta, auto-invalidación), nombrar archivos como `{hash}.json` (lookup O(1), sin índice), usar capa de servicio (principio de responsabilidad única, SRP: la extracción queda pura y el caching es una preocupación separada), serialización JSON manual (control total sobre dataclasses congeladas anidadas), tratar corrupción como `None` (degradación elegante, reprocesa en la siguiente corrida), y creación perezosa del directorio de caché con `mkdir(parents=True)` en el primer write.

Buenas prácticas: hashear contenido y no rutas; trocear (chunk) archivos grandes al hashear para evitar cargarlos enteros en memoria; mantener las funciones de procesamiento puras; loguear hits/misses con hashes truncados; y manejar corrupción de forma robusta sin crashear.

Antipatrones a evitar (con ejemplos de código): cachear usando la ruta del archivo como clave (se rompe con moves/renames); meter la lógica de caching dentro de la función de procesamiento (viola SRP, la función termina con dos responsabilidades); y usar `dataclasses.asdict()` sobre dataclasses congeladas anidadas, que puede causar problemas con tipos complejos anidados — en su lugar usar serialización manual.

Cuándo usarlo: pipelines de procesamiento de archivos (parseo de PDF, OCR, extracción de texto, análisis de imágenes), herramientas CLI que se benefician de opciones `--cache/--no-cache`, procesamiento por lotes donde los mismos archivos reaparecen entre corridas, y para agregar caching a funciones puras existentes sin modificarlas.

Cuándo NO usarlo: cuando los datos deben estar siempre frescos (feeds en tiempo real); cuando las entradas de caché serían extremadamente grandes (mejor considerar streaming); o cuando los resultados dependen de parámetros adicionales más allá del contenido del archivo (por ejemplo, configuraciones de extracción distintas), ya que el hash de contenido solo no capturaría esas variaciones.
