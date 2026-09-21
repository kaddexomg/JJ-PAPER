---
skill: cost-aware-llm-pipeline
idioma_original: en
---

# cost-aware-llm-pipeline

Este skill provee patrones de diseño para controlar el costo de las llamadas a APIs de LLM (Claude, GPT, etc.) sin sacrificar calidad, combinando cuatro técnicas en un pipeline componible: enrutamiento de modelos según complejidad, tracking de presupuesto, lógica de reintentos y prompt caching.

Conviene activarlo cuando se construyen aplicaciones que llaman APIs de LLM, se procesan lotes de ítems con complejidad variable, hay que mantenerse dentro de un presupuesto de gasto, o se busca optimizar costos sin degradar la calidad en tareas complejas. En general aplica a cualquier app que use Claude, OpenAI o similares, pipelines de procesamiento batch, arquitecturas multi-modelo con ruteo inteligente, y sistemas de producción que necesitan guardrails de presupuesto.

Los cuatro conceptos centrales son:

1. **Model Routing por complejidad de tarea**: una función `select_model` elige automáticamente un modelo barato (ej. Haiku) para tareas simples y reserva el modelo caro (ej. Sonnet) para tareas complejas, usando umbrales de longitud de texto (ej. 10.000 caracteres) y cantidad de ítems (ej. 30). Permite forzar un modelo específico si se pasa `force_model`.

2. **Cost tracking inmutable**: usa dataclasses `frozen=True` (`CostRecord` y `CostTracker`) para llevar el registro acumulado de gasto. Cada llamada a la API retorna un nuevo tracker en vez de mutar el estado existente (método `add` que devuelve una nueva instancia). El tracker expone propiedades como `total_cost` y `over_budget` (comparando contra `budget_limit`).

3. **Retry logic acotada ("narrow retry")**: solo reintenta ante errores transitorios como `APIConnectionError`, `RateLimitError` e `InternalServerError`, con backoff exponencial y un máximo de reintentos (por defecto 3). Ante errores de autenticación o de request inválido, falla inmediatamente sin reintentar.

4. **Prompt caching**: cachea los system prompts largos usando `cache_control: {"type": "ephemeral"}` en el contenido del mensaje, para no reenviarlos en cada request y así ahorrar costo y latencia.

El documento muestra cómo componer las cuatro técnicas en una única función `process()`: primero rutea el modelo, luego chequea si se excedió el presupuesto (lanzando `BudgetExceededError` si corresponde), después llama a la API con retry y caching, y finalmente registra el costo de forma inmutable devolviendo el resultado junto con el tracker actualizado.

Incluye una tabla de referencia de precios (2025-2026) por millón de tokens: Haiku 4.5 ($0.80 input / $4.00 output, costo relativo 1x), Sonnet 4.6 ($3.00 / $15.00, ~4x) y Opus 4.5 ($15.00 / $75.00, ~19x).

Como buenas prácticas recomienda: empezar siempre con el modelo más barato y solo escalar cuando se cumplen los umbrales de complejidad; fijar límites de presupuesto explícitos antes de procesar lotes para fallar temprano; loguear las decisiones de selección de modelo para poder ajustar los umbrales con datos reales; usar prompt caching para system prompts de más de 1024 tokens; y nunca reintentar ante errores de autenticación o validación.

Como anti-patrones a evitar señala: usar el modelo más caro para todos los requests sin importar la complejidad, reintentar ante cualquier tipo de error (desperdicia presupuesto en fallos permanentes), mutar el estado del cost tracking (dificulta debugging y auditoría), hardcodear nombres de modelos por todo el código en vez de usar constantes o configuración, e ignorar el prompt caching para prompts de sistema repetitivos.
