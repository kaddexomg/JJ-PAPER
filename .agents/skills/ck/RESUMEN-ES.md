---
skill: ck
idioma_original: en
---

# ck

"ck" (Context Keeper) es un skill de Claude Code que implementa memoria persistente por proyecto. Su objetivo es que, al trabajar en distintos proyectos a lo largo del tiempo, Claude pueda recordar contexto entre sesiones: en qué se estaba trabajando, qué decisiones se tomaron, qué falta hacer y si hubo actividad de git desde el último guardado. Toda la lógica corre mediante scripts Node.js deterministas (no depende del modelo para el comportamiento core), lo que garantiza consistencia entre distintas versiones de modelo.

Cuando el usuario invoca cualquier comando `/ck:*`, Claude debe ejecutar el script Node correspondiente ubicado en `~/.claude/skills/ck/commands/` y mostrar su salida (stdout) al usuario tal cual, expandiendo siempre `~` como `$HOME` en las llamadas Bash.

Estructura de datos: toda la información vive en `~/.claude/ck/`. Ahí hay un `projects.json` que mapea rutas de proyecto a nombre, directorio de contexto y última actualización, y una carpeta `contexts/<nombre>/` por proyecto que contiene `context.json` (la fuente de verdad, en formato v2) y `CONTEXT.md` (una vista generada automáticamente que nunca debe editarse a mano).

Comandos principales:
- `/ck:init`: registra un proyecto nuevo. El script detecta información automáticamente (nombre, descripción, stack, objetivo, restricciones, repo) y Claude debe presentarla como borrador para que el usuario confirme o edite antes de guardarla vía `save.mjs --init`, pasándole un JSON confirmado con un esquema específico.
- `/ck:save`: es el único comando que requiere análisis por parte del LLM. Claude debe analizar la conversación actual y producir: un resumen de una oración (máx. 10 palabras), en qué se quedó trabajando, próximos pasos concretos, decisiones tomadas (qué y por qué), bloqueos actuales, y opcionalmente un objetivo actualizado si cambió. Se muestra un borrador al usuario para confirmación antes de guardarlo con `save.mjs`.
- `/ck:resume [nombre|número]`: da un briefing completo del proyecto vía `resume.mjs`, y luego pregunta si continuar desde ahí o si algo cambió (en cuyo caso se dispara `/ck:save`).
- `/ck:info [nombre|número]`: muestra una instantánea rápida sin preguntas de seguimiento.
- `/ck:list`: muestra una vista de portafolio de todos los proyectos; si el usuario responde con un número o nombre, se ejecuta `/ck:resume`.
- `/ck:forget [nombre|número]`: elimina permanentemente el contexto de un proyecto, pero solo tras pedir confirmación explícita al usuario.
- `/ck:migrate`: convierte datos del formato v1 (CONTEXT.md + meta.json) al nuevo formato v2 (context.json), con opción de dry-run. Los archivos originales se respaldan como `meta.json.v1-backup`, sin borrar nada.

Además, el skill incluye un hook de `SessionStart` (`~/.claude/skills/ck/hooks/session-start.mjs`) que debe registrarse en `~/.claude/settings.json` para que, automáticamente al iniciar sesión, se cargue el contexto del proyecto actual. Este hook inyecta un resumen compacto de unas 5 líneas (~100 tokens), y también detecta sesiones no guardadas, actividad de git desde el último guardado y discrepancias entre el objetivo registrado y el CLAUDE.md del proyecto.

Reglas operativas importantes: los comandos son insensibles a mayúsculas/minúsculas (`/CK:SAVE` = `/ck:save`); si un script termina con código de salida 1, su stdout debe mostrarse como mensaje de error; nunca se debe editar `context.json` ni `CONTEXT.md` directamente, siempre usando los scripts provistos; y si `projects.json` está corrupto o mal formado, hay que avisar al usuario y ofrecer reiniciarlo a `{}`.

En cuanto a cuándo usarlo: se dispara cada vez que el usuario invoca explícitamente alguno de los comandos `/ck:*` (init, save, resume, info, list, forget, migrate), y de forma pasiva al inicio de cada sesión gracias al hook de SessionStart, siempre que esté configurado. El documento no menciona casos explícitos en los que no deba usarse, más allá de las restricciones ya señaladas (no editar los archivos de datos a mano, y pedir confirmación antes de acciones destructivas como `forget`).
