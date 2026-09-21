---
skill: continuous-agent-loop
idioma_original: en
---

# continuous-agent-loop

Este skill define patrones para armar loops de agentes autónomos continuos, incorporando quality gates (controles de calidad), evaluaciones (evals) y controles de recuperación ante fallos. Es el nombre canónico de este skill desde la versión v1.8+, y reemplaza al skill anterior `autonomous-loops`, manteniendo compatibilidad con este durante un release de transición.

Su función principal es ayudar a decidir qué tipo de loop de agente usar según la necesidad del proyecto, y describir cómo combinar distintos componentes para armar un stack de producción robusto, además de anticipar modos de fallo comunes y dar pasos de recuperación.

## Flujo de selección de loop

El skill propone un árbol de decisión simple para elegir la estrategia de loop adecuada:
- Si se necesita control estricto de CI/PR, se recomienda usar `continuous-pr`.
- Si se necesita descomposición de tareas vía RFC (request for comments), se recomienda `rfc-dag`.
- Si se necesita generación exploratoria en paralelo, se recomienda `infinite`.
- Si no aplica ninguno de los casos anteriores, el default es un loop `sequential` (secuencial).

## Patrón combinado recomendado para producción

Para un stack de producción, el skill sugiere combinar cuatro componentes en este orden:
1. Descomposición vía RFC, usando el skill `ralphinho-rfc-pipeline`.
2. Quality gates, combinando el skill `plankton-code-quality` con el comando `/quality-gate`.
3. Loop de evaluación (evals), usando `eval-harness`.
4. Persistencia de sesión, usando `nanoclaw-repl`.

## Modos de fallo a vigilar

El documento identifica cuatro modos de fallo típicos en loops continuos de agentes:
- Iteraciones del loop (churn) sin progreso medible.
- Reintentos repetidos que atacan siempre la misma causa raíz sin resolverla.
- Estancamientos (stalls) en la cola de merge.
- Deriva de costos (cost drift) provocada por escalamiento sin límites.

## Procedimiento de recuperación

Ante alguno de estos fallos, el skill indica una secuencia de recuperación:
1. Congelar (freeze) el loop.
2. Ejecutar el comando `/harness-audit` para auditar el estado.
3. Reducir el alcance (scope) al componente o unidad que está fallando.
4. Repetir (replay) el intento con criterios de aceptación explícitos.

En síntesis, es un documento breve de referencia arquitectónica: no es un tutorial paso a paso de implementación sino una guía de decisión (qué loop elegir, con qué combinarlo, qué señales de alerta vigilar y cómo recuperarse) pensada para quien ya está construyendo o mantiene sistemas de agentes autónomos continuos dentro del ecosistema ECC (Everything Claude Code).
