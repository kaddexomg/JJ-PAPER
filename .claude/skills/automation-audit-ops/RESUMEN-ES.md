---
skill: automation-audit-ops
idioma_original: en
---

# automation-audit-ops

Este skill sirve para auditar, con evidencia real, todo el ecosistema de automatizaciones de un workspace ECC (Everything Claude Code): cron jobs, GitHub Actions, hooks locales, servidores MCP, conectores y scripts wrapper. Se activa cuando el usuario pregunta cosas como "qué automatizaciones tengo", "qué está vivo", "qué está roto" o "dónde hay solapamiento", o cuando la tarea involucra múltiples piezas de automatización y se sospecha que hay redundancia o cosas que se migraron desde otro sistema de agentes y todavía no se reconstruyeron dentro de ECC.

Es un skill "audit-first": el objetivo es producir un inventario respaldado por evidencia y una recomendación de tipo keep / merge / cut / fix-next (mantener / fusionar / eliminar / arreglar a continuación) ANTES de tocar o reescribir nada. No es un skill de reparación inmediata.

Como parte del flujo, integra otros skills nativos de ECC según haga falta: workspace-surface-audit (inventario de conectores, MCP, hooks y apps), knowledge-ops (para reconciliar el estado real del repo con contexto duradero), github-ops (cuando depende de CI, workflows programados o automatización de PRs/issues), ecc-tools-cost-audit (cuando el problema real es fanout de webhooks, jobs en cola o gasto de facturación en el repo de la app hermana), research-ops (para comparar el inventario local contra soporte de plataforma o documentación pública actual) y verification-loop (para probar el estado post-arreglo en vez de asumir que algo se recuperó).

Reglas de guardarraíl (guardrails): empezar en modo solo lectura salvo que el usuario pida explícitamente arreglos; separar cada elemento en categorías de estado (configurado, autenticado, verificado recientemente, obsoleto/roto, faltante); nunca asumir que una herramienta está "viva" solo porque aparece referenciada en un skill o archivo de configuración; y no fusionar ni borrar superficies solapadas hasta que exista la tabla de evidencia.

El workflow tiene 4 pasos:
1. Inventariar la superficie real: leer hooks del repo y scripts locales, GitHub Actions y workflows programados, configuraciones y servidores MCP habilitados, integraciones vía conectores o apps, y scripts wrapper/entrypoints de automatización propios del repo. Luego agrupar todo por superficie: runtime local, CI/automatización de repo, sistemas externos conectados, mensajería/notificaciones, operaciones de facturación/clientes, e investigación/monitoreo.
2. Clasificar cada elemento por su estado real (configurado, autenticado, verificado recientemente, obsoleto/roto, faltante) y por tipo de problema (rotura activa, caída de autenticación, estado obsoleto, solapamiento/redundancia, capacidad faltante).
3. Trazar el camino de prueba: cada afirmación importante debe respaldarse con evidencia concreta (ruta de archivo, ejecución de workflow, log de hook, entrada de configuración, salida de comando reciente, o firma exacta de fallo). Si el estado actual es ambiguo, hay que decirlo explícitamente en vez de simular que la auditoría está completa.
4. Terminar con una recomendación keep / merge / cut / fix-next para cada superficie solapada o sospechosa. El valor está en consolidar la automatización ruidosa en un único carril canónico de ECC, no en preservar cada camino histórico.

El formato de salida esperado tiene cuatro bloques de texto: CURRENT SURFACE (automatización, fuente, estado vivo, prueba), FINDINGS (rotura activa, solapamiento, estado obsoleto, capacidad faltante), RECOMMENDATION (keep/merge/cut/fix next) y NEXT ECC MOVE (el skill/hook/workflow/app exacto a reforzar a continuación).

Entre los pitfalls (errores a evitar) que el documento marca explícitamente: no responder de memoria cuando se puede leer el inventario en vivo; no tratar "presente en la configuración" como sinónimo de "funcionando"; no arreglar redundancias de bajo valor antes de nombrar el camino roto de alto impacto; y no ampliar la tarea hacia una reescritura completa del repo si el usuario solo pidió un inventario.

Como criterios de verificación final: cada afirmación importante debe citar una ruta de prueba en vivo, cada automatización relevada debe tener una etiqueta clara de estado, y la recomendación final debe distinguir con claridad entre keep, merge, cut y fix-next.
