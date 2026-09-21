---
skill: api-connector-builder
idioma_original: en
---

# api-connector-builder

Este skill sirve para construir un nuevo conector o proveedor de API dentro de un repositorio existente, replicando exactamente el patrón de integración que ya usa ese repo, en vez de inventar una arquitectura nueva o paralela. No está pensado para crear un cliente HTTP genérico y aislado, sino para agregar "una integración más" que encaje de forma nativa con las convenciones ya establecidas en el código.

El principio central es que el repositorio anfitrión ya tiene un patrón propio de integración, y ese patrón debe respetarse en varios aspectos: la disposición de archivos del conector, el esquema de configuración, el modelo de autenticación, el manejo de errores, el estilo de tests, y el mecanismo de registro/descubrimiento (registry/discovery) de conectores.

Se dispara cuando piden cosas como: "Build a Jira connector for this project", "Add a Slack provider following the existing pattern", "Create a new integration for this API" o "Build a plugin that matches the repo's connector style".

Guardrails (restricciones explícitas):
- No inventar una arquitectura de integración nueva si el repo ya tiene una.
- No partir únicamente de la documentación del vendor/proveedor externo; primero hay que mirar los conectores existentes en el repo.
- No detenerse en el código de transporte si el repo espera también wiring de registro, tests y documentación.
- No copiar conectores viejos si el repo tiene un patrón más nuevo vigente (evitar el "cargo-culting" de código obsoleto).

El workflow tiene 4 pasos:
1. Aprender el estilo de la casa: inspeccionar al menos 2 conectores/proveedores existentes y mapear su disposición de archivos, límites de abstracción, modelo de configuración, convenciones de retry/paginación, hooks de registro, y fixtures/nomenclatura de tests.
2. Acotar la integración objetivo: definir solo la superficie que el repo realmente necesita (flujo de auth, entidades clave, operaciones de lectura/escritura core, paginación y rate limits, modelo de webhook o polling).
3. Construir en capas nativas del repo: típicamente config/schema, cliente/transporte, capa de mapeo, entrypoint del conector/proveedor, registro, y tests.
4. Validar contra el patrón fuente: el nuevo conector debe verse "obvio" dentro del código base, como si siempre hubiera estado ahí, no como algo importado de otro ecosistema.

El documento incluye tres "formas de referencia" (reference shapes) de estructura de carpetas, según el ecosistema del repo:
- Estilo Provider (Python): providers/existing_provider/ con __init__.py, provider.py, config.py.
- Estilo Connector (Python): integrations/existing/ con client.py, models.py, connector.py.
- Estilo plugin TypeScript: src/integrations/existing/ con index.ts, client.ts, types.ts, test.ts.

Hay un checklist de calidad final para verificar antes de dar por terminado el trabajo: que coincida con un patrón de integración existente en el repo, que exista validación de configuración, que la autenticación y el manejo de errores sean explícitos, que el comportamiento de paginación/retry siga las normas del repo, que el wiring de registro/discovery esté completo, que los tests reflejen el estilo del repo anfitrión, y que se actualicen docs/ejemplos si el repo lo espera.

Finalmente, el skill lista skills relacionados: backend-patterns, mcp-server-patterns y github-ops.
