---
skill: agentic-os
idioma_original: en
---

# agentic-os

Este skill enseña a tratar Claude Code no como una sesión de chat puntual, sino como un runtime u "sistema operativo" persistente para orquestar múltiples agentes especializados. Codifica la arquitectura usada en setups agénticos de producción: un kernel de configuración que enruta tareas a agentes especialistas, memoria persistente basada en archivos, automatización programada y una capa de datos en JSON/markdown, sin depender de bases de datos externas (nada de vector DB, Redis o PostgreSQL).

Se activa cuando se está construyendo un flujo multi-agente dentro de Claude Code, al configurar automatización persistente que sobreviva a reinicios de sesión, al crear un "OS personal" o "agentic OS" para tareas recurrentes, cuando el usuario menciona explícitamente esos términos ("agentic OS", "personal OS", "multi-agent", "agent coordinator", "persistent agent"), o al estructurar proyectos de largo plazo donde el contexto debe persistir entre sesiones.

La arquitectura tiene cuatro capas, cada una como directorio en la raíz del proyecto: `CLAUDE.md` (el kernel: identidad, reglas de enrutamiento, registro de agentes, políticas de modelo — git-tracked), `agents/` (definiciones de agentes especialistas en markdown, con memoria y herramientas acotadas), `.claude/commands/` (comandos slash orientados al usuario, ej. `/daily-sync`), `scripts/` (daemons Python/JS disparados por cron o webhooks) y `data/` (estado: logs append-only, contexto de proyectos, decisiones, en JSON/markdown).

El kernel (`CLAUDE.md`) actúa como un "COO" que nunca escribe código directamente sino que enruta tareas: parsea la intención del usuario, la matchea contra una tabla de Registro de Agentes (ej. @dev, @writer, @researcher, @ops con sus triggers), carga el archivo del agente correspondiente, delega la ejecución con contexto completo y sintetiza el resultado. El principio clave es que el kernel debe ser pequeño y declarativo: la lógica de enrutamiento vive en tablas markdown planas, no en código, para que el sistema sea inspeccionable y editable sin depurar.

Cada agente especialista es un archivo markdown independiente en `agents/` con secciones de Identidad, Memory Scope (qué archivos de `data/` lee y dónde escribe logs), Tool Access (acceso a filesystem, git, test runner, MCP servers) y Constraints. Para tareas que abarcan varios agentes, el kernel los ejecuta secuencial o paralelamente (usando background tasks o scripts shell que invocan Claude Code con contextos de agente específicos), sintetizando los outputs al final.

Los comandos slash son archivos markdown en `.claude/commands/<nombre>.md`, autodescubiertos por Claude Code e invocables con `/<nombre>`. El skill sugiere un set estándar: `/daily-sync`, `/outreach`, `/research <topic>`, `/apply-jobs`, `/analytics`, `/interview-prep`, `/decision <topic>`.

La memoria persistente vive en `data/`, organizada en subcarpetas: `daily-logs/`, `projects/`, `decisions/` (formato ADR), `inbox/`, `contacts/`, `templates/`. Se recomienda un patrón de auto-reflexión al final de cada sesión (qué funcionó, qué no, qué cambiar) para crear un loop de mejora continua sin tocar código.

Para automatización programada, el skill insiste en usar cron externo al sistema operativo (LaunchAgent en macOS, timers de systemd en Linux, o pm2 multiplataforma) en lugar del cron integrado de Claude Code, porque este último muere cuando termina la sesión. Se dan ejemplos concretos de configuración para cada opción, todos invocando `claude --cwd <proyecto> --command /daily-sync`.

La capa de datos usa JSON para estado estructurado (ej. `data/projects/website-v2.json` con status, milestones, agentes involucrados, métricas) y markdown para contenido narrativo (decisiones, logs, notas de investigación). Para evolución de esquemas, nunca se deben renombrar campos existentes: se agregan campos nuevos y los viejos se marcan como deprecados (ej. `_deprecated_priority`), manteniendo los datos históricos legibles sin scripts de migración.

El documento lista anti-patrones a evitar: agente monolítico que hace de todo (en vez de especialistas separados), sesiones sin estado (no leer/escribir `data/` en cada sesión), credenciales hardcodeadas en archivos de agentes o en `CLAUDE.md` (usar variables de entorno o `.env`), usar una base de datos externa para un caso de uso simple de un solo usuario, y enrutamiento sobre-ingenierizado con lógica en código en vez de tablas markdown declarativas.

Finalmente, ofrece un checklist de buenas prácticas: `CLAUDE.md` debe tener menos de 200 líneas y caber en la ventana de contexto; cada archivo de agente debe tener menos de 100 líneas y enfocarse en un solo dominio; `data/` debe ser git-ignored para logs sensibles y git-tracked para decisiones/specs; los comandos deben usar nombres imperativos (`/daily-sync`, no `/run-daily-sync`); los logs son append-only y nunca se editan retroactivamente; cada agente debe tener una sección explícita de Memory Scope; las reflexiones se escriben al final de cada sesión; las tareas programadas usan cron externo; se debe trackear el gasto de API por sesión en `data/logs/<fecha>-costs.json`; y la regla de oro es un proyecto = un Agentic OS, sin compartir un mismo `CLAUDE.md` entre proyectos no relacionados.
