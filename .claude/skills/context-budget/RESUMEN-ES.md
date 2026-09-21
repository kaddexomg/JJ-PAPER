---
skill: context-budget
idioma_original: en
---

# context-budget

Este skill audita el consumo del contexto (ventana de tokens) de una sesión de Claude Code, revisando todos los componentes cargados: agentes, skills, servidores MCP y reglas (rules). Su objetivo es detectar "bloat" (hinchazón), componentes redundantes o duplicados, y generar recomendaciones concretas y priorizadas para recuperar espacio de contexto.

Conviene usarlo cuando la sesión se siente lenta o la calidad de las respuestas empeora, cuando se agregaron recientemente muchos agentes, skills o servidores MCP, cuando se quiere saber cuánto margen de contexto queda disponible, o antes de sumar más componentes para chequear si hay lugar. También es el skill que respalda al comando `/context-budget`.

El funcionamiento se organiza en cuatro fases:

1. **Inventario**: escanea cada tipo de componente y estima su consumo de tokens (aprox. palabras × 1.3). Para agentes (`agents/*.md`) cuenta líneas/tokens por archivo y marca como problema archivos de más de 200 líneas o descripciones de frontmatter de más de 30 palabras. Para skills (`skills/*/SKILL.md`) marca archivos de más de 400 líneas y evita contar dos veces copias idénticas en `.agents/skills/`. Para reglas (`rules/**/*.md`) marca archivos de más de 100 líneas y detecta solapamiento de contenido entre reglas del mismo módulo de lenguaje. Para servidores MCP (`.mcp.json` o config activa) cuenta servidores y herramientas totales, estima un costo de ~500 tokens por esquema de herramienta, y marca servidores con más de 20 herramientas o que simplemente envuelven comandos CLI simples (como `gh`, `git`, `npm`, `supabase`, `vercel`). Para CLAUDE.md (a nivel proyecto y usuario) cuenta tokens de toda la cadena y marca si el total combinado supera las 300 líneas.

2. **Clasificación**: cada componente se ubica en uno de tres buckets: "Siempre necesario" (referenciado en CLAUDE.md, respalda un comando activo o coincide con el tipo de proyecto actual → se mantiene), "A veces necesario" (específico de dominio, no referenciado en CLAUDE.md → considerar activación bajo demanda) o "Rara vez necesario" (sin referencia de comando, contenido solapado, o sin relación clara con el proyecto → eliminar o cargar de forma diferida).

3. **Detección de problemas**: identifica patrones problemáticos como descripciones de agentes infladas (más de 30 palabras, que se cargan en cada invocación del Task tool), agentes pesados (más de 200 líneas, que inflan el contexto en cada spawn), componentes redundantes (skills que duplican lógica de agentes, reglas que duplican CLAUDE.md), sobre-suscripción de MCP (más de 10 servidores, o servidores que envuelven herramientas CLI gratuitas) y bloat en CLAUDE.md (explicaciones verbosas, secciones desactualizadas, instrucciones que deberían ser reglas).

4. **Reporte**: produce un "Context Budget Report" con el overhead total estimado en tokens, el modelo de contexto usado (ej. Claude Sonnet, ventana de 200K), el contexto efectivo disponible, una tabla de desglose por componente (cantidad y tokens de agentes, skills, reglas, herramientas MCP, CLAUDE.md), advertencias de problemas encontrados ordenadas por ahorro potencial de tokens, y un top 3 de optimizaciones con el ahorro estimado de cada una, más el porcentaje total de ahorro potencial. En modo verbose (`--verbose`) agrega conteos de tokens por archivo, desglose línea por línea de los archivos más pesados, líneas redundantes específicas entre componentes solapados, y una lista de herramientas MCP con estimación de tamaño de esquema por herramienta.

El documento incluye tres ejemplos de uso: una auditoría básica (`/context-budget`), el modo verbose, y una consulta de "chequeo previo a expansión" (por ejemplo, evaluar si hay espacio para agregar 5 servidores MCP nuevos antes de hacerlo).

Como buenas prácticas, el skill recomienda: estimar tokens con la fórmula `palabras × 1.3` para prosa y `caracteres / 4` para archivos con mucho código; tener en cuenta que MCP es la palanca de mayor impacto, ya que cada esquema de herramienta cuesta ~500 tokens y un servidor de 30 herramientas puede costar más que todos los skills juntos; recordar que las descripciones de agentes se cargan siempre (incluso si el agente nunca se invoca, su campo description está presente en cada contexto del Task tool); usar el modo verbose solo para depurar y localizar archivos específicos causantes del overhead, no para auditorías regulares; y ejecutar la auditoría después de cada cambio (agregar un agente, skill o servidor MCP) para detectar el crecimiento de overhead a tiempo.
