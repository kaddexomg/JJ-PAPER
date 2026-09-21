---
skill: agentic-engineering
idioma_original: en
---

# agentic-engineering

Este skill define cómo operar como "ingeniero agéntico": un modo de trabajo pensado para flujos de ingeniería donde los agentes de IA hacen la mayor parte de la implementación y los humanos se concentran en controlar calidad y riesgo. No es una herramienta puntual, sino un conjunto de principios y prácticas operativas para estructurar el trabajo con agentes de forma disciplinada, medible y económica.

**Principios operativos centrales**: antes de ejecutar nada hay que definir criterios de completitud (qué significa "terminado"); el trabajo se descompone en unidades del tamaño adecuado para un agente; los modelos se enrutan según la complejidad de la tarea (no usar siempre el modelo más caro); y todo se mide con evaluaciones (evals) y chequeos de regresión, no a ojo.

**Loop eval-first**: el flujo de trabajo recomendado es (1) definir una evaluación de capacidad y una de regresión antes de tocar código, (2) correr una línea base y registrar las firmas de fallo existentes, (3) recién ahí ejecutar la implementación, y (4) volver a correr las evaluaciones y comparar los deltas contra la línea base. La idea es que la evaluación no sea posterior sino que enmarque todo el ciclo.

**Descomposición de tareas**: se propone la "regla de la unidad de 15 minutos": cada unidad de trabajo debe ser verificable de forma independiente, debe tener un único riesgo dominante (no mezclar varios focos de riesgo en la misma unidad) y debe tener una condición de "hecho" clara y explícita.

**Enrutamiento de modelos** (model routing), según el tipo de tarea:
- Haiku: clasificación, transformaciones repetitivas/boilerplate, ediciones acotadas.
- Sonnet: implementación y refactors.
- Opus: arquitectura, análisis de causa raíz, invariantes que cruzan múltiples archivos.

**Estrategia de sesión**: continuar en la misma sesión cuando las unidades de trabajo están fuertemente acopladas; abrir una sesión nueva después de transiciones de fase importantes; y hacer "compact" (compactar contexto) recién al completar un hito, nunca en medio de una sesión de debugging activo, para no perder contexto relevante mientras se investiga un problema.

**Foco de revisión para código generado por IA**: priorizar la revisión en invariantes y casos límite, límites/manejo de errores, supuestos de seguridad y autenticación, y acoplamientos ocultos o riesgos de despliegue (rollout). Explícitamente se indica NO gastar ciclos de revisión en desacuerdos de puro estilo cuando ya existe formateo/linting automatizado que impone esas reglas — es decir, evitar revisión humana redundante con herramientas automáticas.

**Disciplina de costos**: por cada tarea se debe trackear el modelo usado, una estimación de tokens, la cantidad de reintentos, el tiempo de reloj (wall-clock) y si tuvo éxito o falló. La escalada a un modelo de nivel superior solo se justifica cuando el modelo de nivel inferior falla por una brecha de razonamiento clara (no por defecto ni por comodidad).

En cuanto a cuándo usarlo, el propio documento lo encuadra como marco general para "workflows de ingeniería donde los agentes de IA hacen la mayor parte del trabajo de implementación", sin especificar triggers técnicos puntuales ni casos explícitos de exclusión (no menciona cuándo NO usarlo). El archivo no incluye comandos, scripts ni ejemplos de código concretos: es puramente una guía de principios y proceso.
