---
skill: agent-self-evaluation
idioma_original: en
---

# agent-self-evaluation

Este skill hace que el propio agente se detenga después de completar una tarea no trivial y evalúe críticamente su resultado, en lugar de asumir que salió bien. No es un gate de pass/fail, sino un paso deliberado de reflexión pensado para detectar omisiones, señalar exceso de confianza y sacar a la luz áreas de mejora antes de que sea el usuario quien las note.

**Cuándo se activa:** después de escribir código que toca 3+ archivos o supera las 50 líneas; al terminar un workflow de varios pasos (implementar → testear → revisar); tras una sesión de debugging con 3 o más intentos; después de producir un documento de diseño, una decisión de arquitectura o un análisis escrito; cuando el usuario pregunta directamente "¿qué tan bien salió eso?" o "evaluate a vos mismo"; y opcionalmente al final de cualquier sesión mediante un Stop hook configurado (ver `references/hook-integration.md`).

**Los 5 ejes de evaluación**, cada uno puntuado del 1 al 5:
- **Accuracy (precisión):** si los hechos, afirmaciones y resultados son correctos; detecta alucinaciones, nombres de API incorrectos, sintaxis errónea.
- **Completeness (completitud):** si se cubrió todo lo pedido; detecta casos borde no manejados, requisitos olvidados.
- **Clarity (claridad):** si la explicación es comprensible y está bien estructurada; detecta jerga sin definir, falta de contexto.
- **Actionability (accionabilidad):** si el usuario puede actuar de inmediato sobre el resultado; detecta sugerencias vagas o pasos faltantes.
- **Conciseness (concisión):** si se usó el mínimo de palabras/tokens necesarios; detecta redundancia y relleno.

**Escala de puntaje:** 5 = excepcional (sin mejora razonable posible), 4 = bueno (solo detalles menores), 3 = adecuado (cumple pero con una debilidad notable en algún eje), 2 = débil (hay una brecha clara que afecta usabilidad o corrección), 1 = pobre (no cumple la solicitud o tiene errores significativos).

**Regla clave — "la evidencia":** todo puntaje por debajo de 5 debe citar evidencia concreta. No alcanza con decir "podría mejorar"; hay que decir exactamente qué falta o está mal. El lema es "mostrar la brecha, no solo nombrarla".

**Workflow en 4 pasos:**
1. *Recolectar el material crudo*: la solicitud original del usuario, la respuesta final entregada, salidas de herramientas que verifiquen corrección (resultados de tests, exit codes, salida de linters) y cualquier feedback del usuario recibido durante la tarea.
2. *Puntuar cada eje por separado*: leer la pregunta del eje, buscar evidencia (o su ausencia), asignar un puntaje 1-5 y, si es menor a 5, escribir una nota de mejora de una oración citando la brecha. Importante: no promediar mentalmente antes y ajustar hacia atrás — cada eje se puntúa fresco e independiente.
3. *Producir el reporte de evaluación*, usando la plantilla de `templates/evaluation-report.md`, que debe incluir: resumen de una línea, scorecard de los 5 ejes (puntaje + evidencia), puntaje general (promedio simple redondeado a 1 decimal), de 1 a 3 mejoras específicas ordenadas por impacto, y una autochequeo final ("¿el usuario estaría de acuerdo con esta evaluación?").
4. *Aplicar la mejora*: si algún eje puntuó 3 o menos, indicar qué se haría distinto; si la brecha se puede arreglar en menos de 30 segundos (link faltante, frase poco clara) corregirla en el momento; si requiere retrabajo, señalarlo explícitamente indicando qué puntaje se lograría con el fix específico.

El documento incluye dos ejemplos de código ilustrativos: uno de "buena evaluación" (overall 4.6, con una sola brecha de completitud por no manejar timeouts) y uno de "evaluación débil" (overall 2.8, por usar la librería HTTP equivocada, no cubrir todos los métodos HTTP pedidos y duplicar configuración).

**Anti-patrones a evitar:** puntuar "todo es un 5" sin citar evidencia (autocelebración, no evaluación); penalizar de más por scope creep (evaluar solo contra lo que el usuario pidió, no contra lo que podría haberse construido de más); usar la evaluación para re-litigar decisiones de diseño ya tomadas ("como dije antes, esto está mal. Puntaje: 1"); y mezclar preferencia personal con brechas objetivas ("no me gustan los decoradores de Python" no es evidencia válida).

**Buenas prácticas:** evaluar el resultado entregado, no el proceso ni cuántas iteraciones tomó; señalar una sola mejora de alto impacto por eje débil en vez de listar varias; conectar las mejoras con el impacto real en el usuario (ej. "falta manejo de errores implica que la llamada a la API del usuario va a fallar en silencio" es mejor que "agregar manejo de errores"); ser específico sobre cómo se ve el "arreglo"; usar salidas reales de herramientas como evidencia (tests, linters) en vez de adivinar; y si no se encuentra ninguna brecha, insistir más preguntándose "¿qué le molestaría a un usuario de este resultado?", ya que un puntaje perfecto en los 5 ejes es poco frecuente.

**Skills relacionados:** `agent-eval` (comparación cabeza a cabeza de distintos agentes de codificación en tareas de benchmark), `verification-loop` (verificación sistemática de resultados contra lo esperado) y `security-review` (checklist de revisión de código enfocada en seguridad).
