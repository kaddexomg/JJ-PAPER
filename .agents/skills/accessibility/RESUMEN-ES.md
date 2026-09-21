---
skill: accessibility
idioma_original: en
---

# accessibility

Este skill sirve para diseñar, implementar y auditar productos digitales inclusivos siguiendo los estándares WCAG 2.2 nivel AA. Se usa para generar ARIA semántico en Web y los "traits" de accesibilidad equivalentes en plataformas nativas (iOS y Android), garantizando que las interfaces sean Perceptibles, Operables, Comprensibles y Robustas (principios POUR, por sus siglas en inglés). El foco está puesto en la implementación técnica concreta de los criterios de éxito de WCAG 2.2, no solo en teoría.

Conviene usarlo cuando se están definiendo especificaciones de componentes de UI para Web, iOS o Android; al auditar código existente en busca de barreras o incumplimientos de accesibilidad; al implementar criterios nuevos de WCAG 2.2 como el tamaño mínimo de objetivo táctil (Target Size) o la apariencia del foco (Focus Appearance); o al traducir requisitos de diseño de alto nivel en atributos técnicos concretos (roles ARIA, traits, hints).

Los conceptos clave que maneja son: los principios POUR; el "mapeo semántico" (preferir elementos nativos del lenguaje por sobre contenedores genéricos, porque traen accesibilidad incorporada); el "árbol de accesibilidad" (la representación de la UI que efectivamente leen los lectores de pantalla y otras tecnologías asistivas); la gestión del foco (orden y visibilidad del cursor de teclado/lector de pantalla); y el etiquetado mediante atributos como aria-label, accessibilityLabel y contentDescription.

El workflow propuesto tiene 5 pasos:
1. Identificar el rol funcional del componente (botón, link, tab, etc.), priorizando elementos nativos semánticos antes que roles custom.
2. Definir atributos perceptibles: contraste de texto mínimo de 4.5:1 (texto normal) o 3:1 (texto grande/UI), alternativas textuales para contenido no textual, y reflow responsivo hasta 400% de zoom sin pérdida de funcionalidad.
3. Implementar controles operables: tamaño mínimo de objetivo táctil de 24x24 px CSS (WCAG SC 2.5.8), navegabilidad completa por teclado con indicador de foco visible (SC 2.4.11), y alternativas de un solo puntero para gestos de arrastre.
4. Asegurar lógica comprensible: patrones de navegación consistentes, mensajes de error descriptivos con sugerencias de corrección (SC 3.3.3), e implementación de "entrada redundante" (SC 3.3.7) para no pedir el mismo dato dos veces.
5. Verificar robustez: patrones correctos de Name, Role, Value, y uso de aria-live o regiones dinámicas para actualizaciones de estado.

El documento incluye un diagrama de arquitectura (mermaid) que muestra cómo un mismo componente de UI se traduce según la plataforma: en Web usa WAI-ARIA + HTML5, en iOS usa Accessibility Traits + Labels, en Android usa Semantics + ContentDescription, y todos convergen hacia la tecnología asistiva (lectores de pantalla, switches).

También aporta una tabla de mapeo cruzado entre plataformas para cuatro features: etiqueta primaria (aria-label/<label> en Web, .accessibilityLabel() en iOS, contentDescription en Android), hint secundario, rol de acción, y actualizaciones en vivo (live regions), cada uno con su sintaxis específica por plataforma.

Incluye ejemplos de código breves: un formulario de búsqueda accesible en HTML con role="search" y aria-label; un botón de eliminar en SwiftUI con accessibilityLabel, accessibilityHint y accessibilityAddTraits(.isButton); y un Switch en Jetpack Compose con contentDescription vía Modifier.semantics.

Advierte sobre anti-patrones a evitar: usar <div> o <span> como botón sin rol ni soporte de teclado ("div-buttons"); indicar significado únicamente mediante color (por ejemplo, un borde que se pone rojo sin otro indicador); modales que no atrapan el foco (deben contenerlo pero también permitir escapar con la tecla Escape o un botón de cierre explícito, SC 2.1.2); y texto alternativo redundante como "Imagen de..." (los lectores de pantalla ya anuncian que es una imagen).

Da un checklist de buenas prácticas: tamaño de objetivo táctil de 24x24px en Web o 44x44pt en nativo; indicadores de foco visibles y de alto contraste; modales que contienen el foco y lo liberan correctamente al cerrarse; menús/dropdowns que devuelven el foco al elemento disparador al cerrarse; formularios con sugerencias de error en texto; botones de solo ícono con etiqueta textual descriptiva; y contenido que reflowea correctamente al escalar el texto.

Cierra con referencias externas (guías de WCAG 2.2, WAI-ARIA Authoring Practices, guías de accesibilidad de Apple/iOS y Android) y una lista de skills relacionados: frontend-patterns, design-system, liquid-glass-design y swiftui-patterns.
