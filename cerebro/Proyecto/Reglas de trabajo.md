---
tags: [proyecto, reglas]
---

# Reglas de trabajo (obligatorias)

Acordadas con el dueño el 23-jul-2026. Aplican a humanos y a modelos de IA.

## Antes de tocar nada

1. **Confirmar el plan**: qué se va a hacer, por dónde (archivos/tablas) y con qué
   meta. El dueño aprueba el enfoque ANTES de ver código escrito.
2. Leer la nota del módulo afectado en este cerebro y [[Incidentes]].
3. Coordinar con Luis si el cambio toca la operación diaria de la tienda.

## Al trabajar

4. **Features reales, no cascarón**: funciona de punta a punta o no se entrega.
5. **No romper [[wa-server]]**: es producción. Sesión WhatsApp corrupta =
   re-escanear QR y riesgo de baneo del número del negocio.
6. **NUNCA tocar datos de inventario** (stock, costos, conteos) sin orden explícita.
7. Todo en español: UI, comentarios, commits, documentación.
8. `escapeHTML()` en TODA interpolación de datos a HTML.
9. Editar un JS compartido ⇒ subir el `?v=` en los HTML que lo incluyen.
10. Respetar prefijos de función por módulo (`pf*`, `send*`, `ficha*`, `doc*`,
    `wa*`, `cons*`…) y el orden de los `<script>` (ver [[Arquitectura]]).

## Al terminar

11. **Honestidad sobre lo no probado**: decir exactamente qué no se pudo ejecutar
    y cómo se ve el resultado sano para que un humano lo verifique.
12. Deploy = commit + `git push` a `main` (ver [[Configuracion]]). Solo con
    aprobación del dueño.
13. Si el cambio tocó wa-server: recordar REINICIAR el proceso (panel → restart).
14. Actualizar este cerebro: nota del módulo, [[Historia]] y, si nació una trampa,
    [[Incidentes]].

Relacionado: [[CONTEXTO]] · [[Por tarea]] (recetas ya trazadas) · [[Incidentes]] · [[Guia maestra de auditoria]]
