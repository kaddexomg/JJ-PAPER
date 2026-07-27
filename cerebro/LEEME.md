# Cómo usar este cerebro

## En Obsidian

1. Abre Obsidian → "Abrir carpeta como baúl" → elige `cerebro/` (esta carpeta).
2. Empieza por [[INICIO]] (fíjala como nota de inicio: Ajustes → Aspecto → nota inicial).
3. La vista de grafo (Ctrl+G) muestra cómo se conecta todo el proyecto.

El baúl vive DENTRO del repo git: cada `git push` lo respalda y cualquier persona
o modelo de IA que clone el repo lo tiene completo. No requiere plugins.

## Para agentes de IA (sin Obsidian)

Los `[[enlaces]]` apuntan al archivo `.md` con ese nombre dentro de `cerebro/`
(las carpetas son solo organización; los nombres son únicos). Lee [[INICIO]] y
navega siguiendo enlaces como si fueran rutas.

## Mantenimiento (¡importante!)

- Cambio de código relevante → actualizar la nota del módulo tocado.
- Incidente o trampa nueva → agregar a [[Incidentes]].
- Meta nueva o cumplida → actualizar [[Vision y metas]] y [[Pendientes]].
- Trabajo terminado → una línea en [[Historia]] con fecha.
- Este baúl NO se publica al sitio (excluido en `build.sh`); es interno.
