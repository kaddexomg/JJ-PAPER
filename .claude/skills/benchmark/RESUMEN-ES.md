---
skill: benchmark
idioma_original: en
---

# benchmark

Este skill sirve para medir el rendimiento de una aplicación, establecer líneas base (baselines) de performance, detectar regresiones antes y después de un PR, y comparar alternativas de stack tecnológico. Forma parte del origen ECC.

Conviene usarlo en estas situaciones: antes y después de un PR para medir su impacto en performance; al momento de configurar líneas base de rendimiento para un proyecto nuevo; cuando los usuarios reportan que "se siente lento"; antes de un lanzamiento, para asegurar que se cumplen los objetivos de performance; y cuando se quiere comparar el stack propio contra alternativas.

El skill funciona a través de cuatro modos:

1. **Modo 1 — Page Performance (rendimiento de página)**: mide métricas reales del navegador vía MCP de browser. Navega a cada URL objetivo y mide los Core Web Vitals: LCP (Largest Contentful Paint, objetivo < 2.5s), CLS (Cumulative Layout Shift, objetivo < 0.1), INP (Interaction to Next Paint, objetivo < 200ms), FCP (First Contentful Paint, objetivo < 1.8s) y TTFB (Time to First Byte, objetivo < 800ms). También mide tamaños de recursos: peso total de la página (< 1MB), tamaño del bundle JS (< 200KB gzipped), tamaño de CSS, peso de imágenes y peso de scripts de terceros. Además cuenta requests de red y detecta recursos que bloquean el renderizado.

2. **Modo 2 — API Performance**: hace benchmark de endpoints de API. Golpea cada endpoint 100 veces, mide latencias p50, p95 y p99, registra tamaño de respuesta y códigos de estado, prueba bajo carga con 10 requests concurrentes, y compara los resultados contra los objetivos de SLA definidos.

3. **Modo 3 — Build Performance**: mide el ciclo de feedback de desarrollo, incluyendo tiempo de build en frío (cold build), tiempo de hot reload (HMR), duración de la suite de tests, tiempo de chequeo de TypeScript, tiempo de linting y tiempo de build de Docker.

4. **Modo 4 — Comparación Antes/Después**: permite correr el benchmark antes y después de un cambio para medir su impacto. Se usa con los comandos `/benchmark baseline` (guarda las métricas actuales) y `/benchmark compare` (compara contra la línea base guardada). El resultado se presenta como una tabla con columnas Metric, Before, After, Delta y Verdict, mostrando por ejemplo si el LCP empeoró, si el bundle mejoró o si el build tardó más, marcando cada fila como mejora, advertencia (WARN), etc.

En cuanto a la salida (output), el skill almacena las líneas base en la carpeta `.ecc/benchmarks/` en formato JSON, y estos archivos quedan bajo control de Git para que todo el equipo comparta las mismas baselines.

Para integración, se recomienda: correr `/benchmark compare` en cada PR dentro de CI; combinarlo con el skill `/canary-watch` para monitoreo post-deploy; y combinarlo con `/browser-qa` para armar un checklist completo previo al lanzamiento (pre-ship checklist).

El documento no aclara explícitamente casos en los que NO deba usarse este skill.
