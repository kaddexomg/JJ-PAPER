---
skill: continuous-learning
idioma_original: en
---

# continuous-learning

Este skill está DEPRECADO desde el 28 de abril de 2026. La documentación indica explícitamente que debe usarse `continuous-learning-v2` en su lugar, y que este archivo se conserva solo con fines de archivo histórico y compatibilidad con instalaciones existentes. No debe invocarse v1; cualquier solicitud de aprendizaje continuo, aprendizaje de sesión o extracción de patrones debe enrutarse a v2.

**Qué hacía (v1 original):** al finalizar cada sesión de Claude Code, evaluaba automáticamente la conversación para extraer patrones reutilizables y guardarlos como "skills aprendidas" en `~/.claude/skills/learned/`.

**Cómo funcionaba:** operaba como un hook de tipo Stop (se ejecuta al final de la sesión), en tres pasos: 1) Evaluación de sesión, verificando que tuviera un mínimo de mensajes (por defecto 10+); 2) Detección de patrones extraíbles; 3) Extracción y guardado de esos patrones como skills en la carpeta `learned/`. Se configuraba mediante un `config.json` con parámetros como `min_session_length`, `extraction_threshold`, `auto_approve`, `learned_skills_path`, una lista `patterns_to_detect` (error_resolution, user_corrections, workarounds, debugging_techniques, project_specific) y una lista `ignore_patterns` (simple_typos, one_time_fixes, external_api_issues). El hook se registraba en `~/.claude/settings.json` bajo `hooks.Stop`, apuntando al script `~/.claude/skills/continuous-learning/evaluate-session.sh`.

**Tipos de patrones detectados:** resolución de errores, correcciones del usuario, workarounds a problemas de frameworks/librerías, técnicas de debugging efectivas, y convenciones específicas del proyecto.

**Por qué usaba un Stop hook:** se justificaba como liviano (corre una sola vez al final), no bloqueante (no agrega latencia a cada mensaje) y con contexto completo (acceso a todo el transcript de la sesión).

**Cuándo se activaba (según el doc original):** al configurar extracción automática de patrones, al configurar el hook Stop para evaluación de sesión, al revisar o curar skills aprendidas en `~/.claude/skills/learned/`, al ajustar umbrales o categorías de extracción, o al comparar v1 vs v2.

**Cuándo NO usarlo:** el propio archivo indica que no debe invocarse; toda solicitud de este tipo debe dirigirse a `continuous-learning-v2`. Solo tendría sentido mantener v1 si explícitamente se quiere el flujo simple de extracción por Stop hook o se necesita compatibilidad con workflows antiguos de skills aprendidas.

**Comparación con v2 / Homunculus:** el documento incluye notas de investigación (enero 2025) comparando este enfoque con "Homunculus v2", que es más sofisticado: usa hooks PreToolUse/PostToolUse (100% confiables, en vez de solo Stop), analiza con un agente en background (Haiku) en lugar del contexto principal, trabaja con "instincts" atómicos en vez de skills completas, aplica scoring de confianza (0.3-0.9), permite evolución de instincts agrupados hacia skills/comandos/agentes, y soporta exportar/importar instincts. La cita clave recogida es que las skills son probabilísticas (disparan ~50-80% de las veces) mientras que los hooks son 100% confiables. El documento lista mejoras potenciales para v2: aprendizaje basado en instincts atómicos con confianza, observador en background con Haiku, decaimiento de confianza cuando se contradicen, etiquetado por dominio (code-style, testing, git, debugging) y un camino de evolución que agrupa instincts relacionados en skills/comandos/agentes, remitiendo a `docs/continuous-learning-v2-spec.md` para la especificación completa.

**Referencias relacionadas:** una guía externa ("The Longform Guide") con una sección sobre aprendizaje continuo, y el comando `/learn` para extracción manual de patrones a mitad de sesión.
