# Refactor de codigo Python a buenas practicas

Usa esta skill cuando te pidan refactorizar codigo Python existente.

## Reglas de esta skill
1. Nunca cambies el comportamiento observable del codigo sin que te lo pidan explicitamente.
2. Preferí funciones puras y nombres descriptivos por sobre comentarios explicativos.
3. Si el archivo no tiene tests, proponé al usuario crear al menos un test basico
   antes de refactorizar, para poder validar que no rompiste nada.
4. Despues de refactorizar, corré `python -m py_compile <archivo>` con run_command
   para validar que el archivo sigue siendo sintacticamente valido.
5. Mostrá un resumen corto de los cambios hechos, no el diff completo en el chat
   (el usuario puede ver el archivo con read_file si quiere el detalle).
