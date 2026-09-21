---
skill: coding-standards
idioma_original: en
---

# coding-standards

Este skill define el piso mínimo de convenciones de código compartidas entre proyectos: nomenclatura, legibilidad, inmutabilidad y criterios de revisión de calidad. No es la fuente principal para patrones específicos de un framework: para React, estado, formularios y arquitectura de UI remite a `frontend-patterns`; para capas de repositorio/servicio, diseño de endpoints y validación remite a `backend-patterns` o `api-design`; y si solo se necesita la versión más corta de las reglas, sugiere usar `rules/common/coding-style.md` en lugar de recorrer todo el skill.

Se debe activar al iniciar un proyecto o módulo nuevo, al revisar código por calidad y mantenibilidad, al refactorizar para alinear con las convenciones, al hacer cumplir consistencia de nombres/formato/estructura, al configurar linting, formateo o chequeo de tipos, y al incorporar nuevos colaboradores a las convenciones del equipo.

En cuanto a alcance, sí cubre: nomenclatura descriptiva, valores por defecto inmutables, aplicación de KISS/DRY/YAGNI, manejo de errores esperado y detección de code smells. NO debe usarse como fuente principal para composición de React/hooks/rendering, arquitectura backend/diseño de API/capas de base de datos, ni para guías de frameworks específicos cuando ya existe un skill de ECC más acotado para eso.

Los principios centrales de calidad de código son cuatro: (1) Legibilidad primero (el código se lee más de lo que se escribe, nombres claros, código autodocumentado antes que comentarios, formato consistente); (2) KISS (la solución más simple que funcione, evitar sobreingeniería y optimización prematura); (3) DRY (extraer lógica común a funciones/componentes reutilizables, evitar copy-paste); (4) YAGNI (no construir funcionalidades antes de necesitarlas, empezar simple y refactorizar cuando haga falta).

El documento incluye ejemplos concretos en TypeScript/JavaScript y React organizados en pares "PASS" (bueno) / "FAIL" (malo), cubriendo: nombres de variables y funciones (patrón verbo-sustantivo), inmutabilidad crítica (usar spread operator en vez de mutar objetos/arrays directamente, nunca `push` o asignación directa), manejo de errores robusto con try/catch y mensajes claros, ejecución async en paralelo con `Promise.all` en vez de awaits secuenciales innecesarios, y tipado estricto evitando `any`.

Para React, ejemplifica estructura de componentes funcionales tipados, custom hooks reutilizables (ej. `useDebounce`), actualizaciones de estado funcionales (`setCount(prev => prev + 1)` en vez de referenciar el estado directo) y renderizado condicional claro con `&&` en vez de cadenas de ternarios anidados ("ternary hell").

Para diseño de API REST detalla convenciones de rutas (GET/POST/PUT/PATCH/DELETE sobre `/api/markets`), parámetros de query para filtrado, un formato de respuesta consistente (`ApiResponse<T>` con `success`, `data`, `error`, `meta`) y validación de entrada con Zod (`z.object`, manejo de `ZodError` devolviendo 400).

También aborda organización de archivos: estructura de proyecto sugerida (`app/`, `components/`, `hooks/`, `lib/`, `types/`, `styles/`) y convenciones de nombres de archivo (PascalCase para componentes, camelCase con prefijo `use` para hooks, camelCase para utilidades, sufijo `.types` para tipos).

Sobre comentarios y documentación: comentar el "por qué" y no el "qué" (evitar comentarios obvios), y usar JSDoc para APIs públicas con `@param`, `@returns`, `@throws` y `@example`.

En rendimiento, recomienda memoización con `useMemo`/`useCallback` para cálculos costosos y callbacks, lazy loading de componentes pesados con `lazy`/`Suspense`, y en consultas a base de datos seleccionar solo las columnas necesarias (`select('id, name, status')`) en vez de `select('*')`.

Para testing, exige estructura AAA (Arrange-Act-Assert) y nombres de test descriptivos que expliquen el comportamiento esperado, no vagos como "works".

Finalmente, cataloga anti-patrones (code smells) a vigilar: funciones demasiado largas (más de ~50 líneas, deben dividirse), anidamiento profundo (5+ niveles de `if`, resolver con retornos tempranos/early returns) y números mágicos sin explicar (reemplazar por constantes con nombre, ej. `MAX_RETRIES`, `DEBOUNCE_DELAY_MS`).

El skill cierra remarcando que la calidad de código no es negociable: un código claro y mantenible habilita desarrollo rápido y refactorización con confianza.
