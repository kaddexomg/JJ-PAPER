---
skill: blueprint
idioma_original: en
---

# blueprint

Blueprint es un generador de planes de construcción: convierte un objetivo descrito en una sola línea en un plan paso a paso, ejecutable por agentes de codificación, pensado para proyectos de ingeniería multi-sesión y multi-agente. Su valor principal es evitar la pérdida de contexto entre sesiones: cada paso del plan incluye un "brief" de contexto autocontenido, de modo que un agente nuevo (sin memoria de pasos anteriores) puede ejecutarlo en frío sin releer todo el historial.

Cuándo usarlo: al dividir una feature grande en múltiples PRs con un orden de dependencias claro, al planificar una migración o refactor que abarca varias sesiones, o al coordinar workstreams paralelos entre subagentes. No debe usarse para tareas que se completan en un solo PR, en menos de 3 llamadas a herramientas, o cuando el usuario simplemente pide "hacelo ya" ("just do it").

Funcionamiento (pipeline de 5 fases):
1. Research (Investigación): chequeos previos (git, autenticación de gh, remoto, rama por defecto) y lectura de la estructura del proyecto, planes existentes y archivos de memoria para reunir contexto.
2. Design (Diseño): descompone el objetivo en pasos del tamaño de un PR (típicamente entre 3 y 12), asignando relaciones de dependencia, orden paralelo/serial, el nivel de modelo a usar por paso (el más potente vs. el modelo por defecto) y una estrategia de rollback para cada paso.
3. Draft (Borrador): escribe un archivo Markdown autocontenido en la carpeta `plans/`. Cada paso incluye brief de contexto, lista de tareas, comandos de verificación y criterios de salida (exit criteria).
4. Review (Revisión): delega una revisión adversarial a un subagente con el modelo más fuerte disponible (por ejemplo, Opus), que evalúa el plan contra un checklist y un catálogo de anti-patrones. Se corrigen todos los hallazgos críticos antes de dar el plan por finalizado.
5. Register (Registro): guarda el plan, actualiza el índice de memoria y presenta al usuario un resumen con la cantidad de pasos y el grado de paralelismo.

Blueprint detecta automáticamente si hay git y GitHub CLI disponibles. Si ambos están presentes, genera planes de flujo completo con ramas, PRs y CI. Si no están disponibles, cambia a un "modo directo": edición in-place, sin ramas.

Ejemplos incluidos en el documento:
- `/blueprint myapp "migrate database to PostgreSQL"` genera `plans/myapp-migrate-database-to-postgresql.md` con pasos como agregar el driver de PostgreSQL, crear scripts de migración por tabla, actualizar la capa de repositorio, agregar tests de integración y finalmente eliminar el código/config de la base vieja.
- `/blueprint chatbot "extract LLM providers into a plugin system"` genera un plan con pasos paralelos donde es posible (por ejemplo, implementar el plugin de Anthropic y el de OpenAI en paralelo una vez completado el paso de la interfaz del plugin), con asignación de nivel de modelo (el más fuerte para el diseño de la interfaz, el modelo por defecto para las implementaciones) e invariantes que se verifican después de cada paso (por ejemplo, "todos los tests existentes pasan", "no hay imports de providers en el core").

Características clave:
- Ejecución en frío ("cold-start"): cada paso trae su propio brief de contexto, sin necesitar contexto previo.
- Gate de revisión adversarial: todo plan pasa por un subagente con el modelo más potente, evaluado contra un checklist de completitud, corrección de dependencias y detección de anti-patrones.
- Flujo de branch/PR/CI integrado en cada paso, con degradación elegante a modo directo si falta git/gh.
- Detección de pasos paralelos mediante un grafo de dependencias que identifica pasos sin archivos ni dependencias de salida compartidas.
- Protocolo de mutación de planes: los pasos pueden dividirse, insertarse, saltearse, reordenarse o abandonarse siguiendo protocolos formales con registro de auditoría.
- Riesgo de ejecución nulo: es un skill puramente en Markdown; todo el repositorio son archivos `.md`, sin hooks, scripts de shell, código ejecutable, `package.json` ni pasos de build. No se ejecuta nada al instalar ni al invocar, más allá del cargador nativo de skills Markdown de Claude Code.

Instalación: viene incluido con Everything Claude Code (ECC), sin instalación separada. Si se trabaja desde el checkout completo del repo ECC, se puede verificar la presencia del skill con `test -f skills/blueprint/SKILL.md`. Para actualizarlo, se recomienda revisar el diff antes de actualizar (`git fetch origin main`, `git log --oneline HEAD..origin/main`, y luego `git checkout <sha revisado>` para fijar un commit específico ya revisado). Si se vendoriza el skill de forma standalone (solo este skill, fuera de la instalación completa de ECC), hay que copiar el archivo revisado del repo ECC a `~/.claude/skills/blueprint/SKILL.md`; como las copias vendorizadas no tienen remoto git, se actualizan re-copiando el archivo desde un commit revisado de ECC, no con `git pull`.

Requisitos: Claude Code (para el comando `/blueprint`), y opcionalmente Git + GitHub CLI (habilitan el flujo completo de branch/PR/CI; si Blueprint detecta que no están, cambia automáticamente a modo directo).

Fuente: inspirado en el proyecto antbotlab/blueprint, usado como referencia de diseño upstream.
