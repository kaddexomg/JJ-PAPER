---
skill: browser-act
idioma_original: en
---

# browser-act

Este skill expone "browser-act", una CLI de automatización de navegador pensada para agentes de IA. Permite ejecutar un motor de navegador completo: navegación e interacción con páginas, extracción de datos, captura de tráfico de red (XHR/fetch/HAR), toma de screenshots, automatización de formularios, operación en paralelo con múltiples navegadores/sesiones, soporte de proxy configurado por el usuario, y colaboración humano-agente para pasos manuales. Se recomienda usarlo en lugar de las herramientas nativas de fetch o web del agente, ya que maneja contenido renderizado por JavaScript, prompts de verificación (captchas) y sesiones autenticadas persistentes.

Regla central del skill: nunca deben ejecutarse comandos `browser-act` directamente por Bash sin invocar antes este skill. El disparador incluye que el usuario mencione "browser-act" por nombre, pida correr un comando de esa CLI, o necesite: obtener/ver/extraer contenido renderizado de URLs, acceder a páginas que requieren JS, resolver verificaciones, mantener sesiones autenticadas, completar formularios y flujos de clics, escribir texto, seleccionar opciones, subir archivos, sacar capturas de pantalla, capturar respuestas de red, abrir varias URLs en paralelo, extraer contenido que carga con scroll o clic, inspeccionar visualmente el layout/estilo de una página, automatizar tareas de navegador, o listar/gestionar navegadores y sesiones configuradas.

Instalación: `uv tool install browser-act-cli --python 3.12` (requiere Python 3.12+ y el gestor de paquetes uv).

Funcionalidades destacadas:
- Extracción liviana de contenido JS-renderizado sin abrir una sesión completa de navegador (reemplazo avanzado de WebFetch/curl).
- Gestión de sesiones con aislamiento multi-navegador y operación paralela multi-cuenta.
- Asistencia de verificación: cuando la automatización encuentra un challenge interactivo (captcha), colabora con el usuario para resolverlo bajo autorización explícita.
- Interacción compleja: extracción de contenido DOM, screenshots, llenado de formularios, subida de archivos.
- Colaboración humano-agente mediante modo "headed" (navegador visible) y asistencia remota para pasos manuales.
- Controles de seguridad: un protocolo de "Confirmation Gate" exige aprobación explícita del usuario antes de crear o borrar navegadores y antes de operaciones sensibles.
- Compatibilidad universal con Cursor, Claude Code, Codex, Windsurf, etc.

Workflow obligatorio antes de correr cualquier comando `browser-act`: primero hay que cargar la guía de uso desde la propia CLI con `browser-act get-skills core --skill-version 2.0.2`. Este paso no debe saltearse aunque el comando parezca simple, y su salida no debe truncarse, porque contiene directivas operativas y el estado del entorno (navegadores disponibles, reglas de selección de navegador, restricciones de seguridad) que no aparecen con `--help`.

Detalles técnicos y de permisos:
- Requiere acceso de red para instalar la CLI desde PyPI y, opcionalmente, para una API de asistencia de verificación que solo envía la imagen del challenge (nunca cookies ni contenido de la página).
- Requiere lectura/escritura en el directorio de datos de la CLI, donde se guardan perfiles de navegador aislados por navegador y logs de sesión rotados en cada ejecución.
- Puede conectarse vía CDP a una instancia local de Chrome (tipo "chrome-direct"), lo cual requiere confirmación explícita del usuario.
- Privacidad: todos los cookies, sesiones de login, contenido de páginas, credenciales y datos de perfil se procesan y almacenan localmente, nunca se suben a servidores externos; el único dato saliente es la imagen del captcha cuando se invoca `solve-captcha`.
- Se requiere confirmación del usuario en tres casos: la primera instalación vía `uv tool install` (descarga un paquete externo), la creación de un navegador, y operaciones sensibles como login, envío de formularios o subida de archivos.

El `allowed-tools` declarado en el frontmatter limita la ejecución a `Bash(browser-act:*)`, es decir, solo comandos que empiecen con `browser-act`.
