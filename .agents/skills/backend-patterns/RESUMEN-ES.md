---
skill: backend-patterns
idioma_original: en
---

# backend-patterns

Este skill reúne patrones de arquitectura backend y buenas prácticas para aplicaciones server-side escalables, con foco en Node.js, Express y las API routes de Next.js. No es un workflow paso a paso, sino una referencia de patrones de diseño con ejemplos de código en TypeScript listos para adaptar.

Se activa cuando la tarea implica: diseñar endpoints REST o GraphQL, implementar capas de repository, service o controller, optimizar queries de base de datos (problema N+1, indexado, connection pooling), agregar caching (Redis, en memoria, headers HTTP), configurar jobs en background o procesamiento asíncrono, estructurar manejo de errores y validación de APIs, o construir middleware (auth, logging, rate limiting).

Los patrones cubiertos son:

- **Diseño de API REST**: URLs basadas en recursos (GET/POST/PUT/PATCH/DELETE sobre `/api/markets` y `/api/markets/:id`) y uso de query params para filtrado, orden y paginación.
- **Repository Pattern**: abstrae el acceso a datos detrás de una interfaz (ej. `MarketRepository`), con una implementación concreta (ej. sobre Supabase).
- **Service Layer**: separa la lógica de negocio del acceso a datos, orquestando repositorios y otras operaciones (ej. búsqueda por embeddings y ranking por similitud).
- **Middleware**: funciones que envuelven handlers para procesar request/response, con ejemplo de `withAuth` que valida token antes de invocar el handler.
- **Optimización de queries**: seleccionar solo las columnas necesarias en vez de `select('*')`, y evitar el problema N+1 haciendo batch fetch de IDs relacionados en una sola query en vez de una por elemento.
- **Transacciones**: ejemplo de uso de una función RPC de Supabase/PostgreSQL (`plpgsql`) que agrupa varios inserts con rollback automático ante excepción.
- **Caching**: patrón cache-aside (chequear cache, si falla ir a la base y luego actualizar cache) implementado tanto como capa Redis que envuelve un repository (`CachedMarketRepository`) como en una función standalone, con expiración (`setex`, 300 segundos) e invalidación de cache.
- **Manejo de errores**: una clase `ApiError` con status code, y un `errorHandler` centralizado que distingue errores operacionales, errores de validación Zod y errores inesperados (logueados y devueltos como 500). También incluye retry con backoff exponencial (1s, 2s, 4s) para llamadas que pueden fallar transitoriamente.
- **Autenticación y autorización**: validación de JWT (`verifyToken`, `requireAuth`) y control de acceso basado en roles (RBAC), con un mapa de permisos por rol y un higher-order function `requirePermission` que envuelve handlers exigiendo un permiso concreto antes de ejecutarlos.
- **Rate limiting**: el documento aclara explícitamente que el rate limiting en producción debe usar un store compartido (Redis, un gateway, o el limitador nativo de la plataforma), y advierte NO usar contadores en memoria por proceso, porque se resetean en cada deploy, no se comparten entre réplicas y fallan de forma insegura ("fail open") en entornos serverless o multi-instancia. Para esto, el skill delega la definición del contrato HTTP al skill `api-design` y la revisión de casos de abuso al skill `security-review`, dejando a este skill solo la responsabilidad de elegir el punto de integración y el formato de error.
- **Jobs en background**: patrón simple de cola en memoria (`JobQueue`) que procesa jobs de forma asíncrona y no bloqueante (ejemplo de indexado de markets encolado desde un POST).
- **Logging estructurado**: una clase `Logger` que emite entradas JSON con timestamp, nivel, mensaje y contexto (userId, requestId, etc.), usada para trazar requests y loguear errores con su stack trace.

El mensaje de cierre del documento resume la filosofía general: los patrones de backend habilitan aplicaciones server-side escalables y mantenibles, y hay que elegir el patrón adecuado según el nivel de complejidad del proyecto (no aplicar todos siempre).
