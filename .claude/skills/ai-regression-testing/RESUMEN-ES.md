---
skill: ai-regression-testing
idioma_original: en
---

# ai-regression-testing

Este skill define estrategias de testing de regresión pensadas específicamente para desarrollo asistido por IA. El problema central que ataca es que cuando el mismo modelo de IA escribe código y luego lo revisa, arrastra los mismos supuestos y puntos ciegos en ambos pasos, generando un patrón predecible: "la IA escribe el fix, la IA revisa el fix, la IA dice que está correcto, pero el bug sigue existiendo". Solo los tests automatizados pueden romper ese ciclo.

Se activa cuando: un agente de IA (Claude Code, Cursor, Codex) modificó rutas de API o lógica backend; se encontró y corrigió un bug y hay que evitar que reaparezca; el proyecto tiene un modo sandbox/mock que permite testear sin base de datos; se ejecuta un comando tipo `/bug-check` después de cambios de código; o existen múltiples caminos de código (sandbox vs producción, feature flags, etc.).

El documento incluye un ejemplo real donde un mismo bug (falta de un campo `notification_settings`) fue "corregido" cuatro veces y la IA lo revisó y no lo detectó en las primeras tres, hasta que un test automatizado lo atrapó al instante. La conclusión es que la inconsistencia entre el path de sandbox y el de producción es la regresión más común introducida por IA.

Como técnica central propone el "sandbox-mode API testing": aprovechar el modo sandbox/mock de un proyecto para testear endpoints de API sin depender de base de datos, logrando tests rápidos (menos de 1 segundo en total). Da un setup concreto con Vitest + Next.js App Router: configuración de `vitest.config.ts`, un `setup.ts` que fuerza `SANDBOX_MODE=true` y vacía las variables de Supabase, y helpers (`createTestRequest`, `parseResponse`) para simular requests a rutas de API de Next.js con headers como `x-sandbox-user-id`.

El principio para escribir tests de regresión es "testear donde se encontraron bugs, no código que ya funciona": se define un contrato de campos requeridos en la respuesta (`REQUIRED_FIELDS`) y se agregan tests puntuales por cada bug corregido, nombrándolos según el bug que previenen (ej. "BUG-R1 regression"). También se muestra cómo testear paridad sandbox/producción, verificando que ambos paths devuelvan la misma forma de datos.

Propone integrar estos tests en un workflow de "bug-check" mediante un comando personalizado (`.claude/commands/bug-check.md`) con pasos obligatorios: 1) correr `npm run test` y `npm run build` primero (si fallan, es bug de máxima prioridad, sin necesitar juicio de la IA); 2) recién si pasan, hacer revisión de código por IA enfocada en puntos ciegos conocidos (consistencia sandbox/producción, forma de la respuesta API, completitud del SELECT, manejo de errores con rollback, condiciones de carrera en updates optimistas); 3) por cada bug corregido, proponer un test de regresión nuevo.

Documenta cuatro patrones comunes de regresión introducidos por IA, cada uno con ejemplo de código que falla y su corrección: (1) desajuste sandbox/producción (el más frecuente, observado en 3 de cada 4 regresiones) — un campo nuevo se agrega solo al path de producción y no al de sandbox; (2) omisión de columnas en el SELECT — común con Supabase/Prisma al agregar columnas nuevas, donde el campo queda siempre `undefined`; solución: usar `SELECT *` o incluir explícitamente las columnas nuevas; (3) fuga de estado de error — al manejar errores no se limpia el estado anterior (ej. datos de una pestaña previa quedan visibles); (4) actualización optimista sin rollback adecuado — si la llamada a la API falla, el ítem desaparece de la UI pero sigue existiendo en la base de datos; la solución es capturar el estado previo y restaurarlo ante el fallo.

Incluye una tabla de referencia rápida que vincula cada patrón de regresión con su estrategia de test y prioridad (sandbox/producción: alta; SELECT incompleto: alta; fuga de estado de error: media; falta de rollback: media; casteos de tipo que ocultan nulls: media).

Cierra con una lista de DO/DON'T: SÍ escribir tests inmediatamente al encontrar un bug (antes de corregirlo si es posible), testear la forma de la respuesta de la API en vez de la implementación, correr los tests como primer paso de todo bug-check, mantenerlos rápidos, y nombrarlos según el bug que previenen. NO escribir tests para código que nunca tuvo bugs, no confiar en la autorrevisión de la IA como sustituto de tests automatizados, no saltear el testeo del path de sandbox por considerarlo "solo datos mock", no usar tests de integración cuando alcanza con unitarios, y no perseguir porcentaje de cobertura sino prevención real de regresiones.
