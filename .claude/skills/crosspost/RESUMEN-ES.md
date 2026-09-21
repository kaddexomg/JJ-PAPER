---
skill: crosspost
idioma_original: en
---

# crosspost

Este skill se llama "Crosspost" y sirve para distribuir un mismo contenido en varias redes sociales (X, LinkedIn, Threads y Bluesky) adaptándolo a cada plataforma sin caer en el error común de publicar la misma copia "disfrazada" cuatro veces. La consigna central, tal como la resume el propio archivo, es "distribuir contenido entre plataformas sin convertirlo en el mismo post falso con cuatro disfraces".

Se activa cuando el usuario quiere publicar una misma idea en varias plataformas, cuando un lanzamiento, actualización, release o ensayo necesita versiones específicas por plataforma, o cuando el usuario dice frases como "crosspost", "publicá esto en todos lados" o "adaptá esto para X y LinkedIn".

El skill define cinco reglas núcleo que deben respetarse siempre: no publicar la copia idéntica en distintas plataformas; preservar la voz del autor en todas las versiones; adaptar según las restricciones reales de cada red, no según estereotipos; mantener cada post enfocado en una sola idea; y no inventar un llamado a la acción (CTA), una pregunta de cierre o una moraleja si el contenido original no la tenía.

El workflow tiene tres pasos. Paso 1: partir de la versión fuente más fuerte (el post original de X, el artículo, la nota de lanzamiento, el hilo o el memo/changelog); si esa fuente todavía necesita trabajo de voz, primero se debe usar el skill "content-engine". Paso 2: capturar la "huella de voz" (voice fingerprint): si la voz de la fuente no fue capturada aún en la sesión, primero correr el skill "brand-voice" y reutilizar directamente el VOICE PROFILE resultante, sin crear un checklist de voz alternativo salvo que el usuario pida explícitamente un ajuste especial para esa campaña. Paso 3: adaptar el contenido según las restricciones de cada plataforma:

- X: mantenerlo comprimido, empezar con el argumento o dato más filoso, usar un hilo solo si un solo post haría colapsar la idea, y evitar hashtags y relleno genérico.
- LinkedIn: agregar solo el contexto necesario para gente fuera del nicho, no convertirlo en un post falso de "reflexión de founder", no forzar una pregunta de cierre solo porque es LinkedIn, y no imponer un tono "profesional" pulido si el autor es naturalmente más directo/afilado.
- Threads: mantenerlo legible y directo, sin fingir una copy hiper-casual de "creador de contenido", y sin simplemente pegar y acortar la versión de LinkedIn.
- Bluesky: mantenerlo conciso, preservar la cadencia propia del autor, y no depender de hashtags ni lenguaje para "jugar" con el algoritmo del feed.

En cuanto al orden de publicación, por defecto se recomienda: primero publicar la versión nativa más fuerte, luego adaptar para las plataformas secundarias, y solo escalonar los tiempos de publicación si el usuario pide ayuda explícita con la secuenciación. Además, no se deben agregar referencias cruzadas entre plataformas salvo que aporten valor real: la mayoría de las veces cada post debe poder sostenerse solo.

El documento incluye una lista de "patrones prohibidos" que deben eliminarse y reescribirse si aparecen: frases como "Excited to share", "Here's what I learned", "What do you think?", el uso de "link in bio" salvo que sea literalmente cierto, y párrafos genéricos de "conclusión profesional" que no estaban en el contenido original.

El formato de salida esperado debe incluir: la versión para la plataforma primaria, las variantes adaptadas para cada plataforma solicitada, una nota breve explicando qué cambió y por qué, y cualquier restricción de publicación que el usuario todavía deba resolver.

Como control de calidad final, antes de entregar el resultado hay que verificar que cada versión suene como el mismo autor bajo distintas restricciones, que ninguna versión suene rellenada o "sanitizada", que no haya copy duplicado literalmente entre plataformas, y que cualquier contexto extra agregado (por ejemplo para LinkedIn o newsletter) sea realmente necesario.

Finalmente, el skill lista relaciones con otros skills: "brand-voice" para capturar de forma reutilizable la voz derivada de la fuente, "content-engine" para la captura de voz y el modelado del contenido fuente, y "x-api" para los flujos de publicación específicos en X.
