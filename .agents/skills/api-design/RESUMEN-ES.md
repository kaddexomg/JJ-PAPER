---
skill: api-design
idioma_original: en
---

# api-design

Este skill reúne convenciones y buenas prácticas para diseñar APIs REST consistentes y amigables para desarrolladores en entornos de producción. No es un workflow paso a paso sino una referencia de patrones que se activa al diseñar nuevos endpoints, revisar contratos de API existentes, agregar paginación/filtrado/ordenamiento, implementar manejo de errores, planificar una estrategia de versionado, o construir APIs públicas o para partners.

En diseño de recursos, establece que las URLs deben ser sustantivos en plural, minúsculas y kebab-case (ej. `/api/v1/team-members`), evitando verbos en la URL (mal: `/api/v1/getUsers`) y usando sub-recursos para relaciones (`/api/v1/users/:id/orders`). Las acciones que no mapean a CRUD pueden usar verbos con moderación (`POST /api/v1/orders/:id/cancel`).

Sobre métodos HTTP y códigos de estado, detalla la semántica de GET/POST/PUT/PATCH/DELETE (idempotencia y seguridad) y da una referencia completa de códigos: 200/201/204 para éxito, 400/401/403/404/409/422/429 para errores de cliente, y 500/502/503 para errores de servidor. Advierte contra errores comunes como devolver siempre 200 con un campo "success:false", o usar 500 para errores de validación en vez de 400/422.

Define un formato de respuesta estándar con envoltorio: `{ "data": {...} }` para éxito, incluyendo `meta` (paginación) y `links` para colecciones, y `{ "error": { "code", "message", "details" } }` para errores con detalles por campo. Presenta dos variantes de envelope: la opción A (con wrapper `data`, recomendada para APIs públicas) tipada en TypeScript, y la opción B (respuesta plana, común en APIs internas, distinguiendo éxito/error por status code).

En paginación compara dos enfoques: offset-based (simple, con `page`/`per_page`, fácil de implementar pero lento en offsets grandes e inconsistente con inserciones concurrentes) y cursor-based (escalable, con `cursor`/`limit`, rendimiento consistente pero sin salto a páginas arbitrarias). Da una tabla de cuándo usar cada uno: offset para dashboards admin y resultados de búsqueda; cursor para scroll infinito, feeds y APIs públicas.

Para filtrado, ordenamiento y búsqueda muestra sintaxis con query params: igualdad simple, operadores de comparación con notación de corchetes (`price[gte]=10`), valores múltiples separados por coma, campos anidados con notación de punto, ordenamiento con prefijo `-` para descendente y múltiples campos, búsqueda de texto completo con `q=`, y sparse fieldsets (`fields=id,name,email`) para reducir el payload.

En autenticación y autorización cubre Bearer tokens y API keys por header, y patrones de autorización a nivel de recurso (verificar ownership, devolver 403/404 según corresponda) y basados en rol (middleware `requireRole`), con ejemplos en TypeScript/Express.

Sobre rate limiting, especifica los headers estándar (`X-RateLimit-Limit`, `-Remaining`, `-Reset`, y `Retry-After` en 429) y una tabla de niveles sugeridos: anónimo 30/min por IP, autenticado 100/min por usuario, premium 1000/min por API key, interno 10000/min por servicio.

En versionado compara versionado por path (`/api/v1/`, recomendado, explícito y cacheable) contra versionado por header (`Accept: application/vnd.myapp.v2+json`, URLs limpias pero más difícil de testear). Da una estrategia concreta: no versionar hasta que sea necesario, mantener máximo 2 versiones activas, anunciar deprecación con 6 meses de aviso y header `Sunset`, devolver 410 Gone tras la fecha de sunset; aclara qué cambios son no-breaking (agregar campos/parámetros/endpoints) versus breaking (quitar/renombrar campos, cambiar tipos, cambiar estructura de URL o método de auth).

Incluye ejemplos de implementación completos en tres lenguajes/frameworks: TypeScript con Next.js API Route y validación Zod, Python con Django REST Framework (serializers y ViewSet), y Go con net/http (handler manual con manejo de errores tipados).

Cierra con un checklist de diseño de API a revisar antes de publicar un endpoint: convenciones de naming en la URL, método HTTP correcto, códigos de estado apropiados, validación de input con schema, formato estándar de errores, paginación en listados, autenticación requerida o marcada como pública, autorización verificada, rate limiting configurado, que la respuesta no filtre detalles internos (stack traces, errores SQL), naming consistente con endpoints existentes, y documentación (OpenAPI/Swagger) actualizada.
