---
skill: code-tour
idioma_original: en
---

# code-tour

Este skill sirve para crear archivos `.tour` en formato CodeTour: recorridos guiados paso a paso por una base de código, anclados a archivos y números de línea reales, que se abren directamente en el editor. No genera documentación en Markdown ni notas sueltas, sino artefactos `.tour` (JSON) que viven en la carpeta `.tours/`. Además, el skill solo debe crear/editar esos archivos `.tour`; no debe modificar código fuente.

La idea central es que un buen tour cuenta una narrativa dirigida a un lector específico: qué está mirando, por qué importa, y qué camino seguir después, en lugar de ser un listado plano de archivos.

Cuándo usarlo: cuando piden un "code tour", tour de onboarding, walkthrough de arquitectura, tour de PR, cuando el usuario dice "explicá cómo funciona X" y quiere un artefacto reutilizable, cuando se necesita una rampa de entrada para un nuevo desarrollador o revisor, o cuando la tarea se resuelve mejor con una secuencia guiada que con un resumen plano. Ejemplos: onboarding de un nuevo mantenedor, tour de arquitectura de un servicio, walkthrough de revisión de PR anclado a los archivos cambiados, tour de RCA (análisis de causa raíz) mostrando el camino de la falla, o tour de revisión de seguridad sobre límites de confianza.

Cuándo NO usarlo: si alcanza con una explicación puntual en el chat, respondé directamente; si el usuario quiere documentación en prosa (no un artefacto `.tour`), usar `documentation-lookup` o edición de docs del repo; si la tarea es implementación o refactor, hacer ese trabajo directamente; si es onboarding amplio de la base de código sin necesidad de un tour, usar `codebase-onboarding`.

Workflow de 5 pasos:
1. **Descubrir**: explorar el repo antes de escribir nada (README, puntos de entrada, estructura de carpetas, configs relevantes, archivos cambiados si es un tour de PR).
2. **Inferir al lector**: definir la persona y profundidad según el pedido. Hay una tabla de personas sugeridas: `new-joiner` (9-13 pasos), `vibecoder` (5-8 pasos), `architect` (14-18 pasos), `pr-reviewer` (7-11), `rca-investigator` (7-11), `security-reviewer` (7-11), `feature-explainer` (7-11), `bug-fixer` (7-11).
3. **Leer y verificar anclas**: cada ruta de archivo y línea debe ser real; confirmar que el archivo existe, que las líneas están en rango, verificar bloques de selección exactos, y si el archivo es volátil preferir anclas basadas en patrón. Nunca adivinar números de línea.
4. **Escribir el `.tour`**: guardarlo en `.tours/<persona>-<foco>.tour`, con ruta determinística y legible.
5. **Validar**: confirmar que cada ruta referenciada existe, que cada línea/selección es válida, que el primer paso ancla a un archivo o directorio real, que el campo `ref` apunta a una rama/commit que contiene todos los archivos referenciados, y que el tour cuenta una historia coherente y no es solo un listado.

Detalle importante sobre el campo `ref`: liga el tour a una rama o commit de git. Si `ref` no coincide con la rama que tiene el lector, CodeTour abre cada paso desde esa revisión de git (no desde el disco), y si un archivo no existe en esa revisión, el paso falla con el error "The editor could not be opened because the file was not found", aunque el archivo exista en disco — un error fácil de pasar por alto. Reglas para elegirlo: en un tour de PR, usar la rama del PR (nunca la rama base, porque los PR suelen agregar archivos nuevos que no existen en la base); en tours de onboarding/arquitectura, usar la rama que tendrá el lector (a menudo `main`) o dejarlo vacío; si no se está seguro, dejar `ref` vacío para que lea los archivos directo del disco.

Tipos de paso soportados, cada uno con ejemplo JSON en el documento original: **Content** (paso solo de texto, usar con moderación, típicamente de cierre, nunca como primer paso), **Directory** (para orientar sobre un módulo), **File + line** (el tipo por defecto, ancla archivo y línea), **Selection** (ancla un bloque de código con rango de líneas/caracteres), **Pattern** (ancla por patrón de texto cuando las líneas exactas pueden cambiar), y **URI** (para enlazar PRs, issues o docs externos).

Regla de escritura llamada **SMIG** para las descripciones de cada paso: Situation (qué está mirando el lector), Mechanism (cómo funciona), Implication (por qué importa para esa persona), Gotcha (qué podría pasar por alto un lector avispado). Las descripciones deben ser compactas, específicas y basadas en el código real.

Forma narrativa sugerida (arco de 5 partes) salvo que la tarea pida otra cosa: 1) orientación, 2) mapa de módulos, 3) camino de ejecución central, 4) caso borde o gotcha, 5) cierre/próximo paso.

El documento incluye un ejemplo completo de un tour JSON de "API Service Tour" con `$schema`, `title`, `description`, `ref: "main"` y varios `steps` (directory, file+line, content de cierre).

Antipatrones listados con su corrección: listado plano de archivos (contar una historia con dependencia entre pasos), descripciones genéricas (nombrar el camino de código concreto), anclas adivinadas (verificar siempre archivo y línea), demasiados pasos para un tour rápido (recortar agresivamente), primer paso solo de contenido (anclarlo a un archivo o directorio real), y desajuste de persona (escribir para el lector real, no uno genérico).

Buenas prácticas: mantener la cantidad de pasos proporcional al tamaño del repo y la profundidad de la persona; usar pasos de directorio para orientar y pasos de archivo para sustancia; en tours de PR cubrir primero los archivos cambiados; en monorepos acotar el alcance a los paquetes relevantes en vez de recorrer todo; cerrar mostrando qué puede hacer ahora el lector, no un resumen repetido.

Skills relacionados mencionados: `codebase-onboarding`, `coding-standards`, `council`, y el formato upstream oficial `microsoft/codetour`.
