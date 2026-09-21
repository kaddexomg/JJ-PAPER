---
skill: dashboard-builder
idioma_original: en
---

# dashboard-builder

Este skill sirve para construir dashboards de monitoreo (Grafana, SigNoz y plataformas similares) que realmente sean operables, en lugar de "paneles vanidosos" que muestran métricas por mostrar. La premisa central es que el objetivo no es "mostrar cada métrica disponible", sino que el dashboard responda cuatro preguntas concretas: ¿está saludable el sistema?, ¿dónde está el cuello de botella?, ¿qué cambió?, y ¿qué acción debería tomar alguien?

Se activa cuando piden cosas como: "construir un dashboard de monitoreo de Kafka", "crear un dashboard de Grafana para Elasticsearch", "hacer un dashboard de SigNoz para este servicio", o "convertir esta lista de métricas en un dashboard operacional real".

El skill establece varias reglas (guardrails) que hay que respetar: no empezar por el layout visual sino por las preguntas del operador; no incluir todas las métricas disponibles solo porque existen; no mezclar sin estructura paneles de salud, throughput y recursos; y no publicar paneles sin título, unidades y umbrales (thresholds) sensatos.

El workflow tiene cuatro pasos:
1. Definir las preguntas operativas, organizadas en categorías: salud/disponibilidad, latencia/rendimiento, throughput/volumen, saturación/recursos, y riesgo específico del servicio.
2. Estudiar el esquema de la plataforma destino: inspeccionar dashboards existentes para entender la estructura JSON, el lenguaje de queries, las variables, el estilo de thresholds y la organización por secciones.
3. Construir el tablero mínimo útil, con una estructura recomendada de: overview, performance, resources, y una sección específica del servicio.
4. Cortar paneles vanidosos: cada panel debe responder una pregunta real; si no lo hace, se elimina.

Incluye ejemplos concretos de conjuntos de paneles por tipo de servicio:
- Elasticsearch: salud del cluster, asignación de shards, latencia de búsqueda, tasa de indexación, heap/GC de la JVM.
- Kafka: cantidad de brokers, particiones sub-replicadas, mensajes entrantes/salientes, lag de consumidores, presión de disco y red.
- API gateway/ingress: tasa de requests, latencia p50/p95/p99, tasa de error, salud de los upstreams, conexiones activas.

Como checklist de calidad final, el skill pide verificar: que el JSON del dashboard sea válido, que haya agrupación clara por secciones, que existan títulos y unidades, que los thresholds/colores de estado sean significativos, que existan variables para filtros comunes, que el rango de tiempo y el refresh por defecto sean razonables, y que no queden paneles sin valor real para el operador.

Finalmente, lista skills relacionados que pueden complementarlo: `research-ops`, `backend-patterns` y `terminal-ops`.
