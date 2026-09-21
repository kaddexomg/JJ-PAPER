---
skill: codebase-onboarding
idioma_original: en
---

# codebase-onboarding

Este skill analiza sistemáticamente un repositorio de código desconocido y genera dos entregables: una guía de onboarding estructurada y un CLAUDE.md inicial (o mejorado) para el proyecto. Está pensado para desarrolladores que se suman a un proyecto nuevo o que configuran Claude Code por primera vez en un repo existente.

Se dispara cuando: es la primera vez que se abre un proyecto con Claude Code, alguien se une a un equipo o repositorio nuevo, el usuario pide "ayudame a entender este código", pide generar un CLAUDE.md, o dice frases como "onboardeame" o "guiame por este repo".

El workflow tiene cuatro fases:

1. **Reconocimiento**: recolecta señales crudas del proyecto sin leer todos los archivos, corriendo chequeos en paralelo: detección de manifiestos de paquetes (package.json, go.mod, Cargo.toml, pyproject.toml, etc.), fingerprinting de frameworks (Next.js, Nuxt, Angular, Django, Flask, FastAPI, Rails), identificación de entry points, snapshot de los primeros dos niveles del árbol de directorios (ignorando node_modules, vendor, .git, dist, build, etc.), detección de configuración y tooling (linters, tsconfig, Makefile, Dockerfile, CI), y detección de estructura de tests.

2. **Mapeo de arquitectura**: a partir de los datos recolectados identifica el stack tecnológico (lenguajes, frameworks, bases de datos, ORMs, build tools, CI/CD), el patrón arquitectónico (monolito, monorepo, microservicios, serverless, split frontend/backend, estilo de API), mapea los directorios clave a su propósito, y traza el flujo de datos de una request típica (entrada, validación, lógica de negocio, acceso a base de datos).

3. **Detección de convenciones**: identifica patrones ya presentes en el código, como convenciones de nombres de archivos y clases, patrones de manejo de errores, inyección de dependencias vs imports directos, manejo de estado, patrones async, y convenciones de git (nombres de branches, estilo de commits, flujo de PRs). Si el historial de git es inexistente o muy superficial (por ejemplo por un `git clone --depth 1`), esta sección se omite y se aclara que no se pudo detectar.

4. **Generación de artefactos**: produce dos salidas. La primera es una Guía de Onboarding en markdown con secciones de overview, tech stack (en tabla), arquitectura, entry points clave, mapa de directorios, ciclo de vida de una request, convenciones, tareas comunes (comandos de dev, test, lint, migraciones, build) y una tabla "dónde buscar" (qué hacer → dónde mirar). La segunda es un CLAUDE.md inicial con tech stack, estilo de código, testing, build/run y estructura del proyecto; si ya existe un CLAUDE.md, el skill lo lee primero y lo mejora, preservando instrucciones específicas existentes y marcando claramente qué se agregó o cambió.

Buenas prácticas explícitas del skill: no leer todo el repo (usar Glob y Grep para el reconocimiento, Read solo selectivamente ante señales ambiguas); verificar en vez de asumir (si el código real difiere de lo que sugiere la config, confiar en el código); respetar el CLAUDE.md existente en vez de reemplazarlo; mantener la guía concisa, escaneable en 2 minutos, dejando el detalle al propio código; y señalar explícitamente lo que no se pudo determinar en vez de inventar ("no se pudo determinar el test runner" es mejor que una respuesta incorrecta).

Antipatrones a evitar: generar un CLAUDE.md de más de 100 líneas, listar todas las dependencias en vez de solo las relevantes para cómo se escribe código, describir nombres de directorios obvios (como `src/`), y copiar el contenido del README en vez de aportar insight estructural adicional.

El skill incluye tres ejemplos de uso: (1) onboarding completo en un repo nuevo, ejecutando las 4 fases y produciendo tanto la guía como el CLAUDE.md; (2) generación de solo el CLAUDE.md, corriendo las fases 1-3 y omitiendo la guía de onboarding; (3) actualización de un CLAUDE.md existente, leyéndolo primero, corriendo las fases 1-3 y fusionando los nuevos hallazgos con marcas claras de qué se agregó.
