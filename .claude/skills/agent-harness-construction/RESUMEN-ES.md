---
skill: agent-harness-construction
idioma_original: en
---

# agent-harness-construction

Este skill sirve para diseñar y optimizar el "harness" (arnés/andamiaje) de un agente de IA: el espacio de acciones disponible, la definición de herramientas (tools) y el formato de las observaciones que el agente recibe, con el objetivo de aumentar la tasa de finalización exitosa de tareas. Se usa cuando se está mejorando cómo un agente planifica, invoca herramientas, se recupera de errores y converge hacia completar una tarea.

El documento propone un "modelo central" según el cual la calidad del resultado de un agente está condicionada por cuatro factores: la calidad del espacio de acciones, la calidad de las observaciones, la calidad de la recuperación ante errores y la calidad del presupuesto de contexto.

En cuanto al diseño del espacio de acciones, recomienda usar nombres de herramientas estables y explícitos, definir inputs con esquemas (schema-first) y acotados, devolver formas de salida deterministas, y evitar herramientas "todo en uno" (catch-all) salvo que sea imposible aislar funciones.

Sobre granularidad de herramientas, sugiere: micro-tools para operaciones de alto riesgo (deploys, migraciones, permisos); tools de tamaño medio para los ciclos comunes de editar/leer/buscar; y macro-tools solo cuando el costo dominante sea el overhead de ida y vuelta (round-trip).

Para el diseño de observaciones, cada respuesta de herramienta debería incluir cuatro campos: `status` (success/warning/error), `summary` (resultado en una línea), `next_actions` (próximos pasos accionables) y `artifacts` (rutas de archivos o IDs relevantes).

Respecto al contrato de recuperación de errores, cada camino de error debe incluir: una pista de la causa raíz, una instrucción de reintento segura, y una condición de parada explícita.

Sobre presupuesto de contexto (context budgeting), da cuatro pautas: mantener el system prompt mínimo e invariante; mover guías extensas a skills que se cargan bajo demanda; preferir referencias a archivos en lugar de incluir documentos largos inline; y compactar el contexto en los límites de fase (no en umbrales arbitrarios de tokens).

En cuanto a patrones de arquitectura, compara tres enfoques: ReAct (mejor para tareas exploratorias con camino incierto), function-calling (mejor para flujos deterministas y estructurados), y un enfoque híbrido —recomendado— que combina planificación estilo ReAct con ejecución de herramientas tipada.

Para benchmarking, propone rastrear cuatro métricas: tasa de finalización (completion rate), reintentos por tarea, pass@1 y pass@3, y costo por tarea exitosa.

Finalmente, enumera anti-patrones a evitar: tener demasiadas herramientas con semántica superpuesta, salidas de herramientas opacas sin pistas de recuperación, salidas de error sin pasos siguientes, y sobrecarga de contexto con referencias irrelevantes.

El skill no especifica triggers de activación adicionales más allá del propósito general indicado al inicio, ni aclara casos en los que no deba usarse.
