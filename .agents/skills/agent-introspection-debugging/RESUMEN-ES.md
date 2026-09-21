---
skill: agent-introspection-debugging
idioma_original: en
---

# agent-introspection-debugging

Este skill define un flujo de trabajo estructurado para que un agente de IA se auto-depure cuando su ejecución empieza a fallar: bucles repetidos, consumo de tokens sin avance, reintentos sin progreso, deriva de contexto o desajustes entre lo que el agente asume y el estado real del sistema de archivos o el entorno. No es un runtime oculto ni un mecanismo automático: es una guía de razonamiento que enseña al agente a diagnosticarse a sí mismo de forma sistemática antes de escalar el problema a un humano.

Se activa ante señales concretas como: fallas por límite máximo de llamadas a herramientas, reintentos repetidos sin avance real, crecimiento de contexto o degradación de la calidad de las respuestas, desajustes entre entorno esperado y real, o fallos de herramientas que parecen recuperables con un diagnóstico y una corrección acotada. En cambio, no debe usarse como fuente principal para verificar features después de cambios de código (para eso está "verification-loop"), para debugging específico de un framework cuando ya existe un skill más específico en ECC, ni para prometer acciones de "auto-sanación" que el harness actual no puede ejecutar realmente.

El núcleo del skill es un bucle de cuatro fases:

1. **Captura de la falla**: antes de reintentar a ciegas, registrar con precisión el tipo y mensaje de error, el stack trace si existe, la última secuencia de llamadas a herramientas, qué intentaba lograr el agente, señales de presión de contexto (prompts repetidos, logs pegados de más, planes duplicados) y los supuestos sobre el entorno (directorio de trabajo, branch, estado de servicios, archivos esperados). Se ofrece una plantilla markdown mínima para documentar esto.

2. **Diagnóstico de causa raíz**: antes de cambiar nada, mapear la falla a un patrón conocido. Incluye una tabla de patrones típicos con su causa probable y cómo verificarla: llamadas repetidas al mismo comando (bucle sin salida), sobrecarga de contexto (notas o planes duplicados), ECONNREFUSED/timeout (servicio caído o puerto incorrecto), error 429 (tormenta de reintentos sin backoff), archivo faltante tras escribirlo (race condition, cwd o branch equivocados), o tests que siguen fallando tras un "arreglo" (hipótesis errónea). También plantea preguntas de diagnóstico: si es falla lógica, de estado, de entorno o de política; si el agente perdió el objetivo real; si la falla es determinística o transitoria; y cuál sería la acción reversible más pequeña para validar el diagnóstico.

3. **Recuperación contenida**: aplicar la acción más pequeña posible que modifique la superficie del diagnóstico. Acciones seguras: detener los reintentos y replantear la hipótesis, recortar contexto de bajo valor dejando solo objetivo activo, bloqueos y evidencia, revisar el estado real del filesystem/branch/procesos, acotar la tarea a un solo comando/archivo/test fallido, pasar de razonamiento especulativo a observación directa, o escalar a un humano si el riesgo es alto o el bloqueo es externo. Explícitamente se advierte no afirmar acciones de auto-reparación no soportadas (como "resetear el estado del agente" o "actualizar la config del harness") salvo que se estén ejecutando realmente mediante herramientas reales. Incluye también una checklist markdown para documentar la acción de recuperación.

4. **Reporte de introspección**: cerrar con un informe legible para el próximo agente o humano, con formato markdown que incluye sesión/tarea, falla, causa raíz, acción de recuperación, resultado (éxito/parcial/bloqueado), riesgo de consumo de tokens/tiempo, seguimiento necesario y cambio preventivo a codificar más adelante.

Además, el skill propone una heurística de recuperación ordenada por preferencia: (1) replantear el objetivo real en una frase, (2) verificar el estado del mundo en vez de confiar en la memoria, (3) reducir el alcance de la falla, (4) correr una sola verificación discriminante, y (5) recién ahí reintentar. Contrasta un patrón malo (reintentar la misma acción tres veces con variaciones menores de redacción) con uno bueno (capturar la falla, clasificar el patrón, hacer una verificación directa, y cambiar el plan solo si la verificación lo respalda).

En cuanto a integración con otros skills de ECC: usar "verification-loop" después de la recuperación si se modificó código; usar "continuous-learning-v2" cuando el patrón de falla amerite convertirse en un instinto o skill futuro; usar "council" cuando el problema no sea una falla técnica sino ambigüedad de decisión; y usar "workspace-surface-audit" si la falla se originó en estado local conflictivo o deriva del repositorio.

Finalmente, el skill fija un estándar de salida: mientras esté activo, no se debe terminar solo con un "ya lo arreglé". Siempre hay que entregar el patrón de falla identificado, la hipótesis de causa raíz, la acción de recuperación tomada y la evidencia de que la situación mejoró o sigue bloqueada.
