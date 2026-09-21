---
skill: canary-watch
idioma_original: en
---

# canary-watch

Este skill sirve para monitorear y verificar una URL desplegada después de un release, con el objetivo de detectar regresiones antes de que impacten a los usuarios. Es un skill de tipo "smoke test / canary / verificación post-deploy" que corre en bucle hasta que se detiene manualmente o hasta que expira una ventana de observación definida.

Conviene usarlo en varios momentos: después de desplegar a producción o staging, después de mergear un PR riesgoso, cuando se quiere confirmar que un fix realmente solucionó el problema, durante una ventana de lanzamiento donde se necesita monitoreo continuo, y después de actualizar dependencias.

En cuanto a cómo funciona, el skill vigila ocho aspectos de la URL objetivo: 1) el estado HTTP (si la página devuelve 200), 2) errores nuevos en la consola del navegador que no estaban antes, 3) fallos de red como llamadas a la API fallidas o respuestas 5xx, 4) regresiones de performance comparando métricas como LCP, CLS e INP contra una baseline, 5) si desaparecieron elementos clave de contenido (h1, nav, footer, CTA), 6) la salud de endpoints críticos de API (si responden dentro del SLA), 7) que los assets estáticos (JS, CSS, imágenes, fuentes) devuelvan códigos 2xx/3xx con el content-type esperado, y 8) que los streams SSE (event-stream) puedan conectarse y reciban un evento inicial o heartbeat.

El skill ofrece tres modos de watch, todos invocables como comando `/canary-watch`:
- **Quick check** (modo por defecto): una sola pasada de verificación con reporte de resultados. Ejemplo: `/canary-watch https://myapp.com`.
- **Sustained watch**: chequeos periódicos cada N minutos durante M horas, por ejemplo `/canary-watch https://myapp.com --interval 5m --duration 2h`.
- **Diff mode**: compara staging contra producción, por ejemplo `/canary-watch --compare https://staging.myapp.com https://myapp.com`.

Los hallazgos se clasifican en tres niveles de severidad con umbrales definidos:
- **Critical** (alerta inmediata): estado HTTP distinto de 200, más de 5 errores nuevos de consola, LCP mayor a 4 segundos, un endpoint de API que devuelve 5xx, un asset estático que devuelve 4xx/5xx, o un endpoint SSE que no puede conectar o se cae antes del primer heartbeat.
- **Warning** (se marca en el reporte pero no dispara alerta): LCP que aumentó más de 500ms respecto a la baseline, CLS mayor a 0.1, nuevos warnings en consola, tiempo de respuesta más del doble de la baseline, cambio inesperado en el content-type de un asset estático, o latencia de heartbeat SSE más del doble de la baseline.
- **Info** (solo se registra en el log): variaciones menores de performance o aparición de nuevos requests de red (por ejemplo, scripts de terceros agregados).

Cuando se cruza un umbral crítico, el skill dispara notificaciones: notificación de escritorio (macOS/Linux), opcionalmente un webhook a Slack o Discord, y siempre deja un registro en el archivo de log `~/.claude/canary-watch.log`.

La salida del skill es un reporte en formato markdown con una tabla comparando cada check contra su baseline y el delta observado, y un veredicto general (por ejemplo "HEALTHY" con checkmarks o indicando regresiones detectadas), similar a un reporte de estado de canary con timestamp y nombre del sitio.

Finalmente, el documento sugiere integraciones: combinarlo con el skill `/browser-qa` para verificación pre-deploy, agregarlo como hook PostToolUse sobre `git push` para chequear automáticamente después de cada deploy, o ejecutarlo dentro de un pipeline de CI (por ejemplo GitHub Actions) como paso posterior al deploy. El archivo no aclara explícitamente casos en los que no deba usarse.
