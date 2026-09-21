---
skill: claude-devfleet
idioma_original: en
---

# claude-devfleet

Este skill permite orquestar tareas de programación con múltiples agentes de Claude Code en paralelo mediante Claude DevFleet. Sirve para planificar proyectos completos, repartir el trabajo en misiones dependientes entre sí, despachar agentes que trabajan de forma aislada en sus propios worktrees de git (con todo el tooling disponible), monitorear su avance y leer reportes estructurados con lo que cada agente hizo.

Se usa cuando hay que lanzar varios agentes de Claude Code a trabajar en paralelo sobre tareas de código. Cada agente corre en un worktree git aislado, y al terminar su misión el resultado se fusiona (merge) automáticamente a la rama principal; si hay conflicto de merge, los cambios quedan en la rama del worktree del agente para resolución manual.

Requisitos previos: el servidor DevFleet es un proyecto separado, no viene incluido en ECC. Hay que instalarlo y correrlo desde su propio repositorio (https://github.com/LEC-AI/claude-devfleet), y luego conectarlo vía MCP con el comando `claude mcp add devfleet --transport http http://localhost:18801/mcp`. Antes del primer uso conviene verificar que el proceso que escucha en el puerto 18801 sea realmente el binario de DevFleet instalado (ver SECURITY.md sobre servidores MCP en localhost).

Flujo de trabajo general: el usuario pide algo como "construir una API REST con auth y tests" → se llama `plan_project(prompt)`, que devuelve un `project_id` y un DAG de misiones encadenadas → se muestra el plan al usuario y se pide aprobación → se despacha la primera misión con `dispatch_mission(M1)`, que spawnea un agente en su worktree → al completarse M1 se hace auto-merge y se auto-despacha M2 (que depende de M1) → así sucesivamente → se puede consultar `get_report(mission_id)` para ver archivos cambiados, qué se hizo, errores y próximos pasos → finalmente se reporta al usuario.

Herramientas (tools) principales expuestas por el MCP:
- `plan_project(prompt)`: la IA descompone una descripción en un proyecto con misiones encadenadas.
- `create_project(name, path?, description?)`: crea un proyecto manualmente, devuelve `project_id`.
- `create_mission(project_id, title, prompt, depends_on?, auto_dispatch?)`: agrega una misión; `depends_on` es una lista de IDs de misiones de las que depende; `auto_dispatch=true` hace que arranque sola cuando se cumplan las dependencias.
- `dispatch_mission(mission_id, model?, max_turns?)`: inicia un agente en una misión.
- `cancel_mission(mission_id)`: detiene un agente en ejecución.
- `wait_for_mission(mission_id, timeout_seconds?)`: bloquea hasta que la misión termine (por defecto hasta 600 segundos). Para misiones largas se recomienda evitar esto y en cambio consultar `get_mission_status` cada 30-60 segundos, para que el usuario vea progreso.
- `get_mission_status(mission_id)`: consulta el progreso sin bloquear.
- `get_report(mission_id)`: lee el reporte estructurado (archivos modificados, pruebas, errores, próximos pasos).
- `get_dashboard()`: panorama general del sistema (agentes corriendo, estadísticas, actividad reciente).
- `list_projects()` y `list_missions(project_id, status?)`: para listar proyectos y misiones.

El workflow recomendado tiene 5 pasos: 1) Planificar con `plan_project`; 2) Mostrar el plan (títulos de misión, tipos y cadena de dependencias) al usuario; 3) Despachar la misión raíz (la que tiene `depends_on` vacío) — el resto se auto-despacha a medida que se cumplen dependencias, porque `plan_project` les pone `auto_dispatch=true`; 4) Monitorear con `get_mission_status` o `get_dashboard`; 5) Reportar con `get_report` cuando terminan las misiones, compartiendo lo más relevante con el usuario.

Sobre concurrencia: DevFleet corre hasta 3 agentes simultáneos por defecto (configurable con la variable `DEVFLEET_MAX_AGENTS`). Cuando se llenan los slots, las misiones con `auto_dispatch=true` quedan en cola en el "mission watcher" y se despachan solas cuando se liberan slots. Se puede chequear el uso de slots con `get_dashboard()`.

El documento incluye tres ejemplos de uso: (1) modo "full auto" — planificar, despachar la primera misión, dejar que el resto se auto-despache, informar al usuario el project ID y cantidad de misiones, y sondear periódicamente hasta que todas las misiones lleguen a un estado terminal (`completed`, `failed` o `cancelled`), resumiendo éxitos y fallas con sus errores y próximos pasos; (2) modo manual paso a paso — crear proyecto, crear misiones una por una (marcando `auto_dispatch=true` y usando `depends_on` con el ID de la misión raíz), despachar la primera y leer el reporte final; (3) modo secuencial con revisión — crear proyecto, crear e implementar una misión de "Implement feature", desplegarla y sondear su estado, leer su reporte, y luego crear una misión de "Review" que dependa de la anterior con `auto_dispatch=true`, la cual arranca sola porque su dependencia ya está cumplida.

Pautas (guidelines) importantes a respetar: siempre confirmar el plan con el usuario antes de despachar, salvo que haya pedido explícitamente avanzar sin confirmación; incluir títulos e IDs de misión al reportar estado; si una misión falla, leer su reporte antes de reintentar; chequear `get_dashboard()` para ver disponibilidad de slots de agentes antes de despachos masivos; las dependencias de misiones forman un DAG, por lo que no deben crearse dependencias circulares; cada agente corre en un worktree git aislado y hace auto-merge al completar (si hay conflicto, los cambios quedan en la rama del worktree para resolución manual); y al crear misiones manualmente, siempre poner `auto_dispatch=true` si se quiere que se disparen automáticamente al cumplirse sus dependencias, ya que sin ese flag las misiones quedan en estado `draft` sin arrancar solas.
