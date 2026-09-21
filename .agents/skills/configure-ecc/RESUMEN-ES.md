---
skill: configure-ecc
idioma_original: en
---

# configure-ecc

Este skill es un asistente de instalación interactivo para "Everything Claude Code" (ECC), un repositorio con un gran catálogo de skills y reglas reutilizables. Guía al usuario paso a paso, usando la herramienta `AskUserQuestion`, para elegir qué componentes instalar, dónde instalarlos, verificar que la instalación quedó correcta y, opcionalmente, optimizar los archivos instalados para el proyecto concreto del usuario.

Se activa cuando el usuario dice frases como "configure ecc", "install ecc", "setup everything claude code", cuando quiere instalar selectivamente skills o reglas de este repositorio, verificar/reparar una instalación existente de ECC, u optimizar skills o reglas ya instaladas para su proyecto.

Como prerrequisito, el skill debe estar accesible en Claude Code antes de activarse: se puede cargar vía plugin (`/plugin install ecc@ecc`) o copiando manualmente solo este SKILL.md a `~/.claude/skills/configure-ecc/SKILL.md`.

El workflow tiene seis pasos principales:

1. **Clonar el repositorio ECC**: borra cualquier clon previo en `/tmp` y clona `https://github.com/affaan-m/everything-claude-code.git` en `/tmp/everything-claude-code`, guardando la ruta como `ECC_ROOT`. Si falla el clonado, pregunta al usuario por una ruta local alternativa.

2. **Elegir nivel de instalación**: pregunta si instalar a nivel usuario (`~/.claude/`, aplica a todos los proyectos), a nivel proyecto (`.claude/`, solo el proyecto actual) o ambos (compartido a nivel usuario, específico a nivel proyecto). Luego crea los directorios destino (`skills/` y `rules/`).

3. **Seleccionar e instalar skills**: primero pregunta si instalar solo el paquete "Core" (recomendado, cubre ingeniería, evals, verificación, seguridad, compactación estratégica, diseño frontend y skills transversales de Anthropic), Core + niche, o solo niche. Si corresponde elegir categorías niche, ofrece 7 grupos: Framework & Language, Database, Workflow & Quality, Research & APIs, Social & Content Distribution, Media Generation, Orchestration (más "All skills"). En total documenta 45 skills repartidos en 8 categorías (incluye una tabla detallada por categoría con nombre y descripción de cada skill: por ejemplo Framework & Language tiene 25 skills como django-patterns, laravel-tdd, springboot-security, golang-testing, python-patterns, etc.; también Database, Workflow & Quality —incluye tdd-workflow, verification-loop, continuous-learning-v2—, Business & Content, Research & APIs, Social & Content Distribution, Media Generation y Orchestration), más un template standalone. Para cada skill elegido se confirma individualmente y luego se copia el directorio completo (no solo el SKILL.md) desde `$ECC_ROOT/.agents/skills/<skill>` (core) o `$ECC_ROOT/skills/<skill>` (niche) hacia `$TARGET/skills/`. Advierte tener cuidado con rutas con slash final al usar `cp`, y que algunos skills como continuous-learning/-v2 tienen archivos extra (config.json, hooks, scripts) que deben copiarse completos.

4. **Seleccionar e instalar reglas**: ofrece reglas comunes (recomendadas, 8 archivos agnósticos de lenguaje) y paquetes específicos de TypeScript/JavaScript, Python y Go (5 archivos cada uno), copiando los directorios correspondientes. Si el usuario elige reglas específicas de lenguaje sin las comunes, el skill debe advertir que las reglas de lenguaje extienden a las comunes y que podría faltar cobertura.

5. **Verificación posterior a la instalación**: confirma que los archivos existen (`ls -la`), revisa referencias de rutas dentro de los .md instalados (por ejemplo referencias a `~/.claude/` que podrían romperse en instalaciones a nivel proyecto), y chequea dependencias cruzadas conocidas entre skills (p. ej. django-tdd referencia a django-patterns, crosspost referencia a content-engine y x-api, continuous-learning-v2 referencia a `~/.claude/homunculus/`). Por cada problema reporta archivo, línea, descripción del problema y una sugerencia de arreglo.

6. **Optimización opcional**: pregunta si se desea optimizar los skills instalados, las reglas, ambos o ninguno. Al optimizar skills, lee cada SKILL.md, pregunta el stack tecnológico del usuario y sugiere quitar secciones irrelevantes, editando los archivos en el destino de instalación (nunca en el repo fuente `$ECC_ROOT`). Al optimizar reglas, pregunta preferencias como cobertura de tests objetivo (80% por defecto), herramientas de formateo, convenciones de git y requisitos de seguridad, y edita las reglas in-place. Es una regla crítica del skill: jamás modificar archivos dentro del repositorio fuente clonado.

Al finalizar, limpia el clon temporal en `/tmp` y emite un reporte resumen con: nivel y ruta de instalación, cantidad y lista de skills instalados, cantidad de reglas instaladas, resultados de verificación (problemas encontrados/corregidos) y optimizaciones aplicadas.

Incluye además una sección de troubleshooting con casos comunes: skills no detectados por Claude Code (verificar que exista SKILL.md, no solo archivos .md sueltos, y la ruta correcta según nivel de instalación), reglas que no funcionan (las reglas son archivos planos, no en subdirectorios, y puede requerirse reiniciar Claude Code), y errores de referencias de ruta tras instalaciones a nivel proyecto (algunos skills asumen rutas `~/.claude/`, y el directorio `~/.claude/homunculus/` de continuous-learning-v2 siempre es a nivel usuario, lo cual es esperado).
