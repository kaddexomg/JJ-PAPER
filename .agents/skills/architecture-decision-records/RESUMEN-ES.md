---
skill: architecture-decision-records
idioma_original: en
---

# architecture-decision-records

Este skill captura decisiones arquitectónicas tomadas durante las sesiones de trabajo con Claude Code y las convierte en documentos ADR (Architecture Decision Record) estructurados que quedan versionados junto al código, en lugar de perderse en hilos de Slack, comentarios de PR o la memoria de alguien. El objetivo es que futuros desarrolladores entiendan por qué el codebase quedó diseñado de cierta manera.

Se activa cuando el usuario dice explícitamente "registremos esta decisión" o "ADR esto"; cuando elige entre alternativas significativas (framework, librería, patrón, base de datos, diseño de API); cuando dice frases como "decidimos..." o "la razón por la que hacemos X en vez de Y es..."; cuando pregunta "¿por qué elegimos X?" (en ese caso el skill lee los ADR existentes); o durante fases de planificación donde se discuten trade-offs arquitectónicos. También detecta señales implícitas de decisión (comparar frameworks y llegar a una conclusión, elegir esquema de base de datos, elegir monolito vs microservicios, estrategia de auth, infraestructura de deploy), pero en esos casos solo sugiere registrar un ADR, sin crear nada automáticamente sin confirmación del usuario.

El formato de ADR usado es el formato liviano propuesto por Michael Nygard, adaptado para desarrollo asistido por IA, con secciones: número y título, fecha, estado (proposed | accepted | deprecated | superseded by ADR-NNNN), deciders, Contexto, Decisión, Alternativas Consideradas (con pros, contras y motivo de rechazo por cada una) y Consecuencias (positivas, negativas y riesgos).

El workflow para capturar un ADR nuevo tiene ocho pasos: 1) inicializar la carpeta `docs/adr/` solo la primera vez, pidiendo confirmación al usuario antes de crear el directorio, un `README.md` con la tabla índice y un `template.md` en blanco (nunca se crean archivos sin consentimiento explícito); 2) identificar la decisión central; 3) reunir el contexto (qué problema la motivó, qué restricciones existen); 4) documentar alternativas consideradas y por qué se descartaron; 5) plantear las consecuencias y trade-offs; 6) asignar un número incremental escaneando los ADR existentes en `docs/adr/`; 7) presentar el borrador al usuario y escribir el archivo `docs/adr/NNNN-titulo-decision.md` solo tras aprobación explícita (si el usuario rechaza, se descarta sin escribir nada); 8) actualizar el índice en `docs/adr/README.md`.

Para leer ADRs existentes ante la pregunta "¿por qué elegimos X?": primero verifica si existe `docs/adr/` (si no, ofrece empezar a registrar decisiones); si existe, escanea el índice del README para encontrar entradas relevantes, lee los archivos ADR que coincidan y presenta las secciones de Contexto y Decisión; si no encuentra coincidencia, ofrece registrar uno nuevo.

La estructura de directorio esperada es `docs/adr/` con un `README.md` (índice), archivos numerados como `0001-use-nextjs.md`, `0002-postgres-over-mongo.md`, etc., y un `template.md` para uso manual. El índice es una tabla markdown con columnas ADR, Title, Status y Date, enlazando a cada archivo.

El ciclo de vida de un ADR sigue: proposed → accepted → (deprecated | superseded by ADR-NNNN). "Proposed" significa que está en discusión, "accepted" que está vigente, "deprecated" que ya no aplica (por ejemplo, se eliminó la feature), y "superseded" que un ADR más nuevo lo reemplaza (siempre debe enlazarse el reemplazo).

Categorías de decisiones que vale la pena registrar: elecciones de tecnología (framework, lenguaje, base de datos, cloud), patrones de arquitectura (monolito vs microservicios, event-driven, CQRS), diseño de API (REST vs GraphQL, versionado, auth), modelado de datos (esquema, normalización, caching), infraestructura (deploy, CI/CD, monitoreo), seguridad (auth, encriptación, manejo de secretos), testing (framework, cobertura, balance E2E/integración) y proceso (branching, revisión, cadencia de releases).

Buenas prácticas ("Do"): ser específico (por ejemplo "usar Prisma ORM" en vez de "usar un ORM"), registrar el porqué (la razón importa más que el qué), incluir alternativas rechazadas, describir consecuencias con honestidad, mantenerlo corto (legible en 2 minutos) y usar tiempo presente ("usamos X" en vez de "vamos a usar X"). Cosas a evitar ("Don't"): registrar decisiones triviales (nombres de variables, formato), escribir ensayos (si el contexto supera 10 líneas es demasiado largo), omitir alternativas ("simplemente lo elegimos" no es una justificación válida), rellenar decisiones pasadas sin marcarlo como tal, y dejar que los ADR queden obsoletos sin referenciar su reemplazo.

Finalmente, el skill menciona integración con otros agentes/skills: cuando un agente "planner" propone cambios de arquitectura, debería sugerir crear un ADR; y un agente de revisión de código debería marcar los PRs que introducen cambios arquitectónicos sin un ADR correspondiente.
