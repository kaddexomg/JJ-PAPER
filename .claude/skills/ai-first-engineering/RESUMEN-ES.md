---
skill: ai-first-engineering
idioma_original: en
---

# ai-first-engineering

Este skill define un modelo operativo de ingeniería pensado para equipos donde una parte importante del código lo generan agentes de IA. No es una herramienta que ejecute tareas, sino una guía de criterios y prácticas a aplicar cuando se diseña proceso, arquitectura y revisión de código en ese contexto. Se activa cuando hay que tomar decisiones sobre cómo organizar el trabajo, revisar código o evaluar personas en equipos que usan generación de código asistida por IA de forma intensiva.

El documento se organiza en cinco bloques:

1. **Cambios de proceso**: plantea tres prioridades que cambian respecto al desarrollo tradicional. La calidad de la planificación importa más que la velocidad de tipeo; la cobertura de evals (evaluaciones) importa más que la confianza anecdótica en que el código "funciona"; y el foco de la revisión de código se desplaza de la sintaxis hacia el comportamiento del sistema en su conjunto.

2. **Requisitos de arquitectura**: recomienda priorizar arquitecturas "agent-friendly", es decir, amigables para que agentes de IA trabajen sobre ellas. Esto implica límites explícitos entre componentes, contratos estables, interfaces tipadas y tests deterministas. Explícitamente advierte evitar comportamiento implícito repartido en convenciones ocultas, ya que eso dificulta que un agente entienda y modifique el sistema correctamente.

3. **Revisión de código en equipos AI-first**: indica en qué debe concentrarse la revisión cuando gran parte del código es generado por IA: regresiones de comportamiento, supuestos de seguridad, integridad de datos, manejo de fallos y seguridad del despliegue (rollout safety). Sugiere minimizar el tiempo dedicado a problemas de estilo, ya que esos aspectos deberían estar cubiertos por automatización (linters, formatters, etc.), liberando así el foco humano para lo que realmente importa.

4. **Señales de contratación y evaluación**: describe qué caracteriza a un buen ingeniero "AI-first". Estas personas descomponen trabajo ambiguo de forma clara, definen criterios de aceptación medibles, producen prompts y evals de alta señal (es decir, útiles y precisos), y son capaces de mantener controles de riesgo incluso bajo presión de entrega. Son señales pensadas para procesos de hiring o evaluación de desempeño en este tipo de equipos.

5. **Estándar de testing**: propone elevar la exigencia de testing para código generado por IA, incluyendo cobertura de regresión obligatoria para los dominios tocados por un cambio, aserciones explícitas de casos límite (edge cases), y checks de integración específicos para los límites entre interfaces (interface boundaries).

En síntesis, el skill funciona como un marco de referencia breve y de alto nivel (no un procedimiento paso a paso) para adaptar proceso, arquitectura, revisión, contratación y testing a la realidad de equipos donde los agentes de IA escriben gran parte del código, priorizando planificación, contratos claros, evals y controles de riesgo por sobre las prácticas tradicionales centradas en la velocidad de escritura manual de código.
