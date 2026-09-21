---
skill: browser-qa
idioma_original: en
---

# browser-qa

Este skill automatiza pruebas visuales de interfaz y verificación de interacciones de usuario mediante automatización de navegador, pensado para usarse después de desplegar features. Sirve para confirmar que layouts, formularios e interacciones realmente funcionan antes de dar por terminado un trabajo de frontend.

Se recomienda usarlo: después de desplegar a staging/preview, cuando hay que verificar comportamiento de UI en varias páginas, antes de shippear código, al revisar PRs que tocan frontend, y en auditorías de accesibilidad o de diseño responsive.

Funciona apoyándose en un MCP de automatización de navegador (claude-in-chrome, Playwright o Puppeteer), interactuando con páginas en vivo como lo haría un usuario real.

Un principio central es la seguridad ante el "blast radius" (radio de impacto): por defecto se debe operar en modo solo-lectura. Nunca se debe ejecutar un flujo que modifique datos (checkout, pago, borrado, actualización masiva) contra una URL de producción; eso requiere opt-in explícito y una URL de staging/preview. Siempre se deben usar credenciales de prueba (seeded test credentials), nunca logins reales de producción, y hay que redactar credenciales/tokens/PII antes de guardar cualquier captura de pantalla.

El workflow se organiza en cuatro fases:

1. Smoke Test: navegar a la URL objetivo, revisar errores de consola (filtrando ruido de analytics/terceros), verificar que no haya respuestas 4xx/5xx en la red, capturar pantalla above-the-fold en desktop y mobile, y chequear Core Web Vitals (LCP < 2.5s, CLS < 0.1, INP < 200ms; se aclara que INP reemplazó a FID en marzo de 2024).

2. Interaction Test: hacer clic en todos los links de navegación para detectar enlaces rotos, enviar formularios con datos válidos e inválidos verificando estados de éxito y error, probar el flujo de autenticación (login → página protegida → logout, solo con credenciales de prueba) y probar journeys críticos de usuario (checkout, onboarding, búsqueda) — en modo solo-lectura por defecto, ejecutando journeys mutantes solo en staging con opt-in explícito.

3. Visual Regression: capturar pantallas de páginas clave en tres breakpoints (375px, 768px, 1440px) y compararlas contra baselines ya commiteados. Si no hay baseline, se debe reportar el resultado como INCONCLUSIVE, nunca dar un PASS silencioso. También hay que marcar layout shifts mayores a 5px, elementos faltantes u overflow, y revisar el dark mode si aplica.

4. Accessibility: correr axe-core u equivalente en cada página, marcar violaciones de WCAG 2.2 AA (contraste, labels, orden de foco), verificar que la navegación por teclado funcione de punta a punta y chequear los landmarks para lectores de pantalla. El documento aclara explícitamente que axe-core cubre automáticamente solo entre el 30% y 40% de WCAG, así que un resultado limpio es necesario pero no suficiente: siempre hace falta un chequeo manual de navegación por teclado, orden de foco y lectura con screen reader. No se debe reportar "accesible" basándose solo en un pase automatizado.

El resultado se entrega en un formato de reporte estandarizado en Markdown ("QA Report") con secciones para Smoke Test, Interactions, Visual y Accessibility, cada ítem marcado con check (✓) o cruz (✗), y un veredicto final que puede ser SHIP, SHIP WITH FIXES, DO NOT SHIP o INCONCLUSIVE (este último si no hay baseline visual disponible).

En cuanto a integración técnica, el skill funciona con cualquier MCP de navegador: las herramientas `mChild__claude-in-chrome__*` (preferidas, porque usan el Chrome real del usuario), Playwright vía `mcp__browserbase__*`, o scripts directos de Puppeteer. Se recomienda combinarlo con el skill `/canary-watch` para monitoreo posterior al despliegue (post-deploy monitoring).
