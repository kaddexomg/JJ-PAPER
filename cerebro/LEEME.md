# Cómo usar este cerebro

## En Obsidian

1. Abre Obsidian → "Abrir carpeta como baúl" → elige `cerebro/` (esta carpeta).
2. Empieza por [[CONTEXTO]] (el embudo) y luego [[INICIO]] (el mapa completo).
3. La vista de grafo (Ctrl+G) muestra cómo se conecta todo. Las notas de
   `Conceptos/` son los nodos centrales: cada una cruza varios módulos.

El baúl vive DENTRO del repo git: cada `git push` lo respalda y cualquier persona
o modelo de IA que clone el repo lo tiene completo. No requiere plugins.

## Para agentes de IA (sin Obsidian)

Los `[[enlaces]]` apuntan al archivo `.md` con ese nombre dentro de `cerebro/`
(las carpetas son solo organización; los nombres son únicos). Ruta recomendada:

1. **[[CONTEXTO]]** — el embudo: el 80% del contexto en una lectura.
2. La nota de **concepto** de la entidad que vas a tocar ([[Cliente]], [[Pedido]],
   [[Stock]]…), que enlaza a todos los módulos donde vive.
3. **[[Mapa de archivos]]** si partiste de un archivo y no sabes qué es.
4. **[[Por tarea]]** si tu trabajo es de los que ya tienen receta.

## Mantenimiento (¡importante!)

- Cambio de código relevante → actualizar la nota del módulo tocado.
- Incidente o trampa nueva → agregar a [[Incidentes]].
- Meta nueva o cumplida → actualizar [[Vision y metas]] y [[Pendientes]].
- Trabajo terminado → una línea en [[Historia]] con fecha.
- Este baúl NO se publica al sitio (excluido en `build.sh`); es interno.
