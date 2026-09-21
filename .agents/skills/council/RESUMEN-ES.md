---
skill: council
idioma_original: en
---

# council

Este skill convoca un "consejo" de cuatro voces para ayudar a tomar decisiones ambiguas, resolver disyuntivas (tradeoffs) o dar un veredicto de "seguir/no seguir" cuando existen varios caminos válidos y no hay un ganador obvio. Está pensado específicamente para decisiones bajo incertidumbre, no para revisión de código, planificación de implementación ni diseño de arquitectura.

Las cuatro voces son: la voz de Claude en el contexto actual (que actúa como Architect), y tres subagentes independientes lanzados en paralelo: un Skeptic (cuestiona premisas y busca simplificar), un Pragmatist (prioriza velocidad de entrega e impacto real de usuario) y un Critic (busca casos límite, riesgos y modos de falla). Cada voz tiene un lente definido: el Architect se enfoca en corrección, mantenibilidad e implicancias a largo plazo.

Cuándo usarlo: cuando hay múltiples caminos creíbles sin ganador claro, cuando se necesita exponer tradeoffs explícitamente, cuando el usuario pide segundas opiniones o disenso, cuando existe riesgo real de "anclaje conversacional" (seguir la inercia de la conversación), o cuando una decisión go/no-go se beneficiaría de un desafío adversarial. Ejemplos dados: monorepo vs polyrepo, lanzar ya vs esperar pulir más, feature flag vs rollout completo, achicar alcance vs mantener amplitud estratégica.

Cuándo NO usarlo (con alternativas sugeridas en el doc): para verificar si un output es correcto (usar `santa-method`), para descomponer una feature en pasos de implementación (usar `planner`), para diseñar arquitectura de sistema (usar `architect`), para revisar código en busca de bugs o seguridad (usar `code-reviewer` o `santa-method`), para preguntas puramente fácticas (responder directo) o para tareas de ejecución obvias (simplemente hacerlas).

Punto clave del mecanismo: las tres voces externas deben lanzarse como subagentes "frescos", recibiendo solo la pregunta y el contexto relevante —nunca toda la conversación previa—, ya que esa es la técnica anti-anclaje que evita que simplemente repitan la postura ya insinuada en el hilo.

Workflow en 6 pasos:
1. Extraer la pregunta real: reducir la decisión a qué se está decidiendo, qué restricciones importan y qué cuenta como éxito; si es vaga, hacer una pregunta aclaratoria antes de convocar al consejo.
2. Reunir solo el contexto necesario: si es específico de un repo, juntar archivos/snippets/métricas relevantes de forma compacta; si es estratégico/general, evitar snippets de código salvo que cambien materialmente la respuesta.
3. Formar primero la posición del Architect (la voz en contexto): escribir postura inicial, tres razones principales y el riesgo principal, antes de leer a las otras voces, para que la síntesis final no sea un simple espejo de las voces externas.
4. Lanzar las tres voces externas en paralelo, cada una con la pregunta, contexto compacto, un rol estricto y sin historial de conversación innecesario. El doc incluye una plantilla de prompt exacta que pide a cada subagente responder con: Position (1-2 frases), Reasoning (3 bullets), Risk (mayor riesgo) y Surprise (algo que las otras voces podrían pasar por alto), todo en menos de 300 palabras y sin rodeos.
5. Sintetizar con reglas anti-sesgo: no descartar una visión externa sin explicar por qué, señalar explícitamente si una voz externa cambió la recomendación propia, incluir siempre el disenso más fuerte aunque se rechace, tratar como señal real si dos voces coinciden en contra de la postura inicial, y mantener visibles las posturas crudas antes del veredicto.
6. Presentar un veredicto compacto en un formato Markdown fijo (bloque "## Council: [título]") con la posición de cada voz (Architect, Skeptic, Pragmatist, Critic) más una sección de Verdict con Consensus, Strongest dissent, Premise check y Recommendation, pensado para ser legible en pantalla de celular.

Regla de persistencia: este skill no debe escribir notas ad-hoc en `~/.claude/notes` u otras rutas paralelas. Si el consejo cambia materialmente la recomendación, hay que usar `knowledge-ops` para guardar la lección en el lugar durable correcto, o `/save-session` si pertenece a memoria de sesión, o actualizar directamente el issue de GitHub/Linear correspondiente si afecta la ejecución activa. Solo se debe persistir una decisión cuando cambia algo real.

Rondas múltiples: por defecto es una sola ronda; si el usuario pide otra, hay que mantener la nueva pregunta enfocada, incluir el veredicto previo solo si es necesario, y mantener al Skeptic lo más "limpio" posible para preservar el valor anti-anclaje.

Antipatrones listados: usar council para revisión de código, usarlo cuando la tarea es solo trabajo de implementación, pasarle a los subagentes toda la transcripción de la conversación, ocultar el desacuerdo en el veredicto final, y persistir cada decisión como nota sin importar su relevancia.

Skills relacionados mencionados: `santa-method` (verificación adversarial), `knowledge-ops` (persistir deltas de decisión), `search-first` (reunir material de referencia externo antes del consejo) y `architecture-decision-records` (formalizar el resultado si la decisión se vuelve política de sistema de largo plazo).

Ejemplo final del doc: la pregunta "¿deberíamos lanzar ECC 2.0 como alpha ahora, o esperar a que la UI del plano de control esté más completa?", mostrando cómo cada voz aportaría un ángulo distinto (integridad estructural, si la UI es realmente el factor bloqueante, qué se puede lanzar sin dañar la confianza, y carga de soporte/confusión de rollout). El valor del skill no es la unanimidad, sino hacer visible el desacuerdo antes de decidir.
