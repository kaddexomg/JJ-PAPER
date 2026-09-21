---
skill: benchmark-optimization-loop
idioma_original: en
---

# benchmark-optimization-loop

Este skill transforma pedidos vagos o exagerados como "hacé esto 20 veces más rápido" o "probá 50 optimizaciones recursivas" en un proceso de optimización acotado y medible, capaz de mejorar un sistema de forma real y verificable. Está pensado para situaciones donde el usuario pide hacer algo más rápido, probar muchas variantes de implementación, correr una optimización recursiva, medir latencia/throughput/costo, o elegir la mejor implementación entre varias mediante pruebas repetidas.

**Línea base obligatoria**: antes de empezar a optimizar, el skill exige tener definidos varios elementos: cuál es la operación a optimizar, qué gate (control) de corrección debe seguir pasando siempre, cuál es la métrica objetivo (tiempo total, latencia p95, filas por segundo, costo por corrida, memoria o tasa de error), cuál es la línea base actual, y cuál es el presupuesto de búsqueda (máximo de variantes, tiempo máximo, gasto máximo, impacto máximo permitido sobre los datos). Si el usuario pide un objetivo poco realista, el skill indica mantener la ambición pero igual acotar y medir el proceso.

**El loop de trabajo** consta de 8 pasos: 1) medir la línea base; 2) identificar cuellos de botella basándose en evidencia; 3) generar variantes que prueben una hipótesis cada una; 4) ejecutar las variantes con la misma forma de entrada (input shape); 5) descartar las variantes que fallen en corrección, seguridad o reproducibilidad; 6) promover la variante más rápida que sea segura; 7) codificar el camino ganador en un script, comando, test, configuración o documento; 8) volver a correr la línea base y el ganador para confirmar la mejora (delta).

**Tabla de variantes**: el skill recomienda llevar un registro tabular de cada variante probada, con columnas como Variante, Hipótesis, Comando, Tiempo, Correcto (sí/no) y Notas. Incluye un ejemplo con una línea base ("baseline") y dos variantes, una ganadora por reducir tiempo de 120s a 42s mediante batching, y otra descartada por fallar (rate limited) pese a ser más rápida en teoría.

**Búsqueda recursiva**: para trabajos recursivos o de ajuste de hiperparámetros, el skill indica persistir cada corrida en un ledger (registro), comparar siempre contra el mejor resultado aceptado previamente (no solo contra la corrida anterior), mantener un chequeo de holdout o replay, y detener la búsqueda cuando la mejora esté dentro del margen de ruido, falle la corrección, se supere el presupuesto de costo, o la búsqueda empiece a modificar más variables de las que se pueden explicar. Recomienda usar la expresión "mejor variante segura medida" en vez de "óptimo global", salvo que el espacio de búsqueda haya sido realmente exhaustivo.

**Gate de promoción**: una variante no puede convertirse en el nuevo valor por defecto hasta que se cumplan estas condiciones: que los tests de corrección pasen, que la mejora de rendimiento sea repetible o esté explicada, que el rollback (reversión) sea obvio, que el cambio quede codificado en control de versiones o en un runbook durable, y que el resumen final incluya los comandos exactos y las mediciones obtenidas.

En cuanto a herramientas, el skill tiene acceso a Read, Write, Edit, Bash, Grep y Glob, coherente con su naturaleza de medir, editar código/config y ejecutar comandos de benchmarking.
