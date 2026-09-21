---
skill: content-engine
idioma_original: en
---

# content-engine

Este skill sirve para crear sistemas de contenido nativos de cada plataforma (X, LinkedIn, video corto, YouTube, newsletter) sin aplanar la voz real del autor en el típico "contenido genérico de plataforma". Se activa cuando el usuario pide posts o hilos para X, posts o actualizaciones de lanzamiento para LinkedIn, guiones para video corto o explicativos de YouTube, cuando se quiere reconvertir artículos, podcasts, demos, documentación o notas internas en contenido público, o cuando hay que armar una secuencia de lanzamiento o un sistema de contenido continuo alrededor de un producto, insight o narrativa.

Principios no negociables: partir siempre de material fuente real (no de fórmulas genéricas de post), adaptar el formato a la plataforma sin adaptar la personalidad del autor, que cada post transmita una sola afirmación concreta, priorizar especificidad por sobre adjetivos vacíos, y no usar "engagement bait" salvo que el usuario lo pida explícitamente.

El workflow es "source-first": antes de redactar hay que identificar el conjunto de fuentes disponibles (artículos publicados, notas o memos internos, demos de producto, documentación o changelogs, transcripciones, capturas de pantalla, posts previos del mismo autor). Si el usuario quiere una voz específica, hay que construir un perfil de voz a partir de ejemplos reales antes de escribir, usando el skill `brand-voice` como workflow canónico de voz cuando la consistencia importa en más de un output (múltiples outputs, o contenido sensible de lanzamiento, difusión o reputación). Ese perfil de voz resultante ("VOICE PROFILE") se reutiliza en content-engine en vez de reconstruir un segundo modelo de voz. Incluso si el usuario quiere específicamente la voz de "Affaan / ECC", `brand-voice` sigue siendo la fuente de verdad, alimentada con el mejor material en vivo o derivado de fuentes disponible.

Hay una lista de frases y patrones prohibidos que deben eliminarse y reescribirse: "In today's rapidly evolving landscape", palabras como "game-changer", "revolutionary", "cutting-edge", el cliché "here's why this matters" sin algo concreto después, cerrar con preguntas al estilo LinkedIn solo para generar respuestas, casualidad forzada en LinkedIn, y relleno de "engagement" que no estaba en el material original.

El skill define reglas de adaptación por plataforma: en X, abrir con la afirmación, artefacto o tensión más fuerte, mantener la compresión si la voz fuente es comprimida, y en hilos cada post debe hacer avanzar el argumento sin relleno innecesario. En LinkedIn, expandir solo lo necesario para que gente fuera del nicho entienda, sin convertirlo en un falso post de "lección" ni caer en cadencia inspiracional corporativa ni relleno tipo "journey" o elogios apilados. En video corto, guionar en torno a la secuencia visual y los puntos de prueba, mostrando el resultado o problema en los primeros segundos, evitando narración que suene mejor escrita que hablada. En YouTube, mostrar el resultado o tensión temprano, organizar por argumento o progresión (no por secciones de relleno) y usar capítulos solo si aportan claridad. En newsletter, abrir directamente con el punto, conflicto o artefacto, sin párrafo de calentamiento, y que cada sección sume algo nuevo.

El "flujo de repurposing" (reconversión de un asset a múltiples piezas) tiene 7 pasos: elegir el asset ancla, extraer entre 3 y 7 claims o escenas atómicas, rankearlas por filo, novedad y prueba, asignar una idea fuerte por output, adaptar la estructura a cada plataforma, eliminar el relleno típico de cada plataforma, y correr el control de calidad final.

Cuando se pide una campaña, los entregables son: un perfil de voz breve (si importa matchear voz), el ángulo central, los borradores nativos por plataforma, un orden de publicación (solo si ayuda a la ejecución), y los huecos de información que faltan cubrir antes de publicar.

El control de calidad final antes de entregar verifica que cada borrador suene al autor real (no al estereotipo de la plataforma), que contenga una afirmación real, prueba u observación concreta, que no queden frases de hype genérico ni "engagement bait" falso, que no haya copy duplicado entre plataformas (salvo pedido explícito), y que cualquier CTA esté justificado y aprobado por el usuario.

Por último, el skill señala relaciones con otros skills: `brand-voice` para generar perfiles de voz a partir de fuentes reales, `crosspost` para la distribución específica por plataforma, y `x-api` para obtener posts recientes y publicar contenido aprobado en X.
