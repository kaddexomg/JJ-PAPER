---
skill: agent-eval
idioma_original: en
---

# agent-eval

Este skill es una herramienta CLI liviana para comparar agentes de codificación (Claude Code, Aider, Codex, etc.) entre sí sobre tareas reproducibles definidas por el usuario. Su motivación es que las comparaciones de "qué agente es mejor" suelen hacerse a ojo, y esta herramienta busca sistematizar ese proceso con métricas concretas.

Se activa cuando se quiere: comparar agentes de codificación sobre el propio código base, medir el rendimiento de un agente antes de adoptar una nueva herramienta o modelo, correr chequeos de regresión cuando un agente actualiza su modelo o tooling, o producir decisiones de selección de agentes respaldadas por datos para un equipo. La nota de instalación indica que agent-eval debe instalarse desde su repositorio tras revisar el código fuente (no viene preinstalado).

Conceptos clave del funcionamiento:
- **Definiciones de tareas en YAML**: cada tarea declara nombre, descripción, repo objetivo, archivos a tocar, el prompt de instrucciones, uno o más "judges" (criterios de evaluación) y opcionalmente un commit fijo para reproducibilidad.
- **Aislamiento con git worktree**: cada ejecución de un agente corre en su propio worktree de git, sin necesidad de Docker, lo que evita que los agentes interfieran entre sí o corrompan el repo base.
- **Métricas recolectadas**: tasa de aciertos (pass rate, si el código pasa el judge), costo (gasto de API cuando está disponible), tiempo (segundos de reloj hasta completar) y consistencia (tasa de aciertos across corridas repetidas, ej. 3/3 = 100%).

El workflow tiene tres pasos:
1. Definir tareas: crear un directorio `tasks/` con archivos YAML, uno por tarea.
2. Correr agentes: por ejemplo `agent-eval run --task tasks/add-retry-logic.yaml --agent claude-code --agent aider --runs 3`. Cada corrida crea un worktree fresco desde el commit especificado, le pasa el prompt al agente, ejecuta los criterios del judge y registra pass/fail, costo y tiempo.
3. Comparar resultados: `agent-eval report --format table` genera un reporte tabular comparando agentes por tarea (pass rate, costo, tiempo, consistencia).

Existen tres tipos de judges: basados en código/deterministas (ej. correr pytest o `npm run build`), basados en patrones (grep sobre archivos con un patrón regex), y basados en modelo (LLM-as-judge, donde se le pide a un LLM que evalúe si la implementación cumple ciertos criterios, ej. manejo correcto de backoff exponencial).

Buenas prácticas recomendadas: empezar con 3-5 tareas representativas del trabajo real (no ejemplos de juguete); correr al menos 3 trials por agente para capturar varianza, ya que los agentes son no determinísticos; fijar el commit en el YAML de la tarea para que los resultados sean reproducibles en el tiempo; incluir al menos un judge determinista (tests, build) por tarea, porque los judges basados en LLM agregan ruido; trackear el costo junto con el pass rate (un agente con 95% de aciertos pero 10x más caro puede no ser la mejor elección); y versionar las definiciones de tareas como si fueran código, tratándolas como fixtures de test.

El skill declara acceso a las herramientas Read, Write, Edit, Bash, Grep y Glob. El repositorio de referencia es github.com/joaquinhuigomez/agent-eval.
