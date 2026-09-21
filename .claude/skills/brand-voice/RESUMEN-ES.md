---
skill: brand-voice
idioma_original: en
---

# brand-voice

Este skill construye un perfil de voz de escritura a partir de material fuente real (posts, ensayos, notas de lanzamiento, documentación o copy de sitio web) y luego reutiliza ese perfil en flujos de trabajo de contenido, outreach y redes sociales. Su objetivo es lograr consistencia de voz evitando los clichés genéricos de escritura generada por IA, en vez de re-derivar el estilo desde cero cada vez o caer en un tono genérico por defecto.

Se activa cuando el usuario quiere contenido u outreach con una voz específica, al escribir para X, LinkedIn, email, posts de lanzamiento, hilos o actualizaciones de producto, al adaptar el tono de un autor conocido a través de canales, o cuando el flujo de contenido existente necesita un sistema de estilo reutilizable en lugar de imitación puntual.

**Prioridad de fuentes** (de mayor a menor preferencia): 1) posts y hilos originales recientes de X, 2) artículos, ensayos, memos o newsletters, 3) emails o DMs reales de outbound que funcionaron, 4) documentación de producto, changelogs, framing de README y copy de sitio. No se debe usar material genérico de plataforma como fuente.

**Flujo de recolección**: reunir entre 5 y 20 muestras representativas cuando estén disponibles; priorizar material reciente sobre el antiguo (salvo que el usuario indique que lo antiguo es más canónico); separar la "voz pública de lanzamiento" de la "voz privada de trabajo" si la fuente lo permite claramente; si hay acceso en vivo a X, usar el skill `x-api` para traer posts originales recientes antes de redactar; si importa el copy del sitio, incluir la landing page actual de ECC y el framing del repo/plugin.

**Qué extraer del material**: ritmo y largo de oración, compresión vs. explicación, normas de mayúsculas, uso de paréntesis, frecuencia y propósito de preguntas, qué tan tajantes son las afirmaciones, frecuencia de números/mecanismos/pruebas concretas, cómo funcionan las transiciones, y qué es lo que el autor nunca hace.

**Contrato de salida**: producir un bloque reutilizable `VOICE PROFILE` que otros skills puedan consumir directamente, siguiendo el esquema definido en `references/voice-profile-schema.md`. El perfil debe mantenerse estructurado y lo bastante corto como para reutilizarse dentro del contexto de sesión; el objetivo no es crítica literaria sino reutilización operativa.

**Defaults de Affaan / ECC**: si el usuario quiere la voz de Affaan/ECC y las fuentes en vivo son escasas, se puede partir de esta base (salvo que material más nuevo la reemplace): directo, comprimido, concreto; los detalles, mecanismos, pruebas y números superan a los adjetivos; los paréntesis sirven para calificar, acotar o sobre-clarificar; las mayúsculas son convencionales salvo razón real para romperlas; las preguntas son poco frecuentes y no deben usarse como gancho; el tono puede ser filoso, directo, escéptico o seco; las transiciones deben sentirse ganadas, no suavizadas artificialmente.

**Prohibiciones estrictas** (a eliminar y reescribir si aparecen): ganchos de curiosidad falsos, la fórmula "no X, solo Y", la frase "sin relleno" ("no fluff"), minúsculas forzadas, la cadencia de "thought-leader" de LinkedIn, preguntas trampa/carnada, la frase "Excited to share", relleno genérico de "viaje del fundador", y paréntesis cursis.

**Reglas de persistencia**: reutilizar el último `VOICE PROFILE` confirmado a través de tareas relacionadas dentro de la misma sesión; si el usuario pide un artefacto durable, guardar el perfil en la ubicación de workspace o superficie de memoria solicitada; no crear archivos versionados en el repo que almacenen huellas de voz personal salvo que el usuario lo pida explícitamente.

**Uso downstream**: este skill debe usarse antes o dentro de `content-engine`, `crosspost`, `lead-intelligence`, escritura de artículos o lanzamientos, y outbound frío o cálido en X, LinkedIn y email. Si otro skill ya tiene una sección parcial de captura de voz, este skill es la fuente canónica de verdad.
