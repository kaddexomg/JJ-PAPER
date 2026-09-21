---
skill: autonomous-agent-harness
idioma_original: en
---

# autonomous-agent-harness

Este skill convierte a Claude Code en un sistema de agente autónomo y persistente, usando exclusivamente funciones nativas de Claude Code (crons, dispatch, memoria) y servidores MCP, sin depender de frameworks externos. Su propósito explícito es reemplazar herramientas standalone de agentes como Hermes o AutoGPT, aprovechando la infraestructura ya existente de Claude Code.

Antes que nada, el skill establece límites de consentimiento y seguridad: la operación autónoma debe ser pedida y delimitada explícitamente por el usuario. No se deben crear schedules, despachar agentes remotos, escribir memoria persistente, usar control de computadora, publicar externamente, modificar recursos de terceros ni actuar sobre comunicaciones privadas sin aprobación explícita del usuario y del workspace de destino. Se recomienda preferir planes en modo "dry-run" y colas locales en archivos antes de habilitar acciones recurrentes o disparadas por eventos, y mantener credenciales, datos personales y automatizaciones específicas de cuenta fuera de artefactos reutilizables de ECC.

Cuándo activarlo: cuando el usuario quiere un agente que corra continuamente o en un horario, workflows automatizados con disparo periódico, un asistente personal que recuerde contexto entre sesiones, frases como "run this every day" / "check on this regularly" / "keep monitoring", cuando se busca replicar funcionalidad de Hermes/AutoGPT, o cuando se necesita combinar computer use con ejecución programada.

Arquitectura: el runtime de Claude Code integra cuatro componentes (Crons para programar tareas, Dispatch para agentes remotos, Memory Store, y Computer Use), que se apoyan en una capa de skills/agents/commands/hooks de ECC, la cual a su vez usa una capa de servidores MCP (memory, github, exa, supabase, browser-use, etc.).

Componentes centrales:
1. Memoria persistente: combina la memoria nativa de Claude Code (archivos markdown con frontmatter en `~/.claude/projects/*/memory/`, cargados automáticamente al iniciar sesión) con un servidor MCP de memoria que ofrece un grafo de conocimiento estructurado (entidades, relaciones, observaciones) consultable entre sesiones. Se distinguen tres horizontes: corto plazo (TodoWrite dentro de la sesión), mediano plazo (archivos de memoria del proyecto) y largo plazo (grafo MCP con `create_entities`, `create_relations`, `add_observations`).
2. Operaciones programadas (crons): se crean vía `mcp__scheduled-tasks__create_scheduled_task` (con nombre, expresión cron, prompt y directorio de proyecto) o mediante `claude -p` en modo programático. Incluye una tabla de patrones típicos: standup diario (9am días hábiles), revisión semanal (lunes 10am), monitoreo horario, build nocturno (2am) y preparación pre-reunión (cada 30 min).
3. Dispatch/agentes remotos: permite disparar agentes de Claude Code de forma event-driven, por ejemplo desde CI/CD vía curl a la API de dispatch, desde un webhook de GitHub, o desde otro agente encadenando `claude -p`.
4. Computer use: mediante el MCP de computer-use se habilita automatización de navegador (navegar, clickear, llenar formularios, capturas), control de escritorio y operaciones de filesystem más allá de la CLI; casos de uso incluyen testing automatizado de UIs web, entrada de datos y monitoreo por screenshots.
5. Cola de tareas: se implementa persistiendo una cola en un archivo de memoria (`task-queue.md`) con frontmatter tipo "project" y secciones de tareas activas/completadas en formato checklist markdown.

El documento incluye una tabla de equivalencias que mapea cada componente de Hermes (Gateway/Router, Memory System, Tool Registry, Orchestration, Computer Use, Context Manager, Task Queue) a su equivalente en ECC/Claude Code.

Guía de instalación en 4 pasos: (1) configurar los servidores MCP necesarios (memory, scheduled-tasks, computer-use) en `~/.claude.json`; (2) crear crons base, por ejemplo un briefing matutino diario o una tarea semanal de aprendizaje continuo que extrae patrones de las sesiones; (3) inicializar el grafo de memoria creando entidades para el perfil del usuario, sus proyectos y contactos clave; (4) habilitar computer use opcionalmente, otorgando los permisos necesarios al MCP correspondiente.

Se proponen tres workflows de ejemplo completos: un revisor autónomo de PRs (cada 30 min, revisa PRs nuevos, corre tests, revisa cambios con un agente code-reviewer y postea comentarios vía GitHub MCP), un agente de investigación personal (diario a las 6am, corre búsquedas guardadas en Exa, compara contra resultados previos y escribe un digest), y un agente de preparación de reuniones (disparado 30 min antes de cada evento de calendario, que junta contexto de asistentes desde email/Slack y prepara un documento).

Finalmente, el skill enumera restricciones importantes: las tareas cron corren en sesiones aisladas y no comparten contexto con sesiones interactivas salvo a través de la memoria; el computer use requiere permisos explícitos y no debe asumirse acceso; el dispatch remoto puede tener límites de rate, por lo que los crons deben diseñarse con intervalos apropiados; los archivos de memoria deben mantenerse concisos, archivando datos viejos en vez de dejarlos crecer sin límite; y siempre hay que verificar que las tareas programadas se completaron exitosamente, agregando manejo de errores a los prompts de los crons.
