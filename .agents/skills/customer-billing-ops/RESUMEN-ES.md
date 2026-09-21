---
skill: customer-billing-ops
idioma_original: en
---

# customer-billing-ops

Este skill sirve para operar workflows reales de facturación de clientes (suscripciones, reembolsos, triage de churn, recuperación vía portal de facturación y análisis de planes), usando herramientas de billing conectadas como Stripe. No está pensado para diseño genérico de APIs de pago, sino para casos operativos concretos de soporte al cliente. El objetivo final es que el operador pueda responder cuatro preguntas: quién es el cliente, qué pasó, cuál es el arreglo más seguro, y qué seguimiento hay que enviarle.

Se debe usar cuando: un cliente reporta que la facturación está rota, pide un reembolso o no puede cancelar; se investigan suscripciones duplicadas, cargos accidentales, renovaciones fallidas o riesgo de churn; se revisa la mezcla de planes, suscripciones activas, conversión mensual/anual o confusión de asientos de equipo (team seats); se crea o valida un flujo de portal de facturación; o se auditan quejas de soporte relacionadas con suscripciones, facturas, reembolsos o métodos de pago.

En cuanto a herramientas preferidas: usar primero herramientas de billing conectadas como Stripe; usar email, GitHub o issue trackers solo como evidencia de apoyo; y preferir portales de facturación/cliente ya hosteados por la plataforma antes que construir código de gestión de cuenta a medida, cuando la plataforma ya ofrece los controles necesarios.

Hay guardrails importantes: nunca exponer claves secretas, datos completos de tarjetas ni PII innecesaria del cliente en la respuesta; no reembolsar a ciegas, primero hay que clasificar el problema; y distinguir entre estos casos: compra duplicada accidental, compra deliberada multi-asiento o de equipo, producto roto/valor no cumplido, checkout fallido o incompleto, y cancelación por falta de controles self-serve. Para planes anuales, de equipo o con prorrateo, hay que verificar la forma del contrato antes de actuar.

El workflow tiene cinco pasos:
1. Identificar al cliente claramente, partiendo del identificador más fuerte disponible (email, ID de cliente de Stripe, ID de suscripción, ID de factura, o usuario de GitHub/email de soporte si se sabe que mapea a billing). Se devuelve un resumen de identidad: cliente, suscripciones activas, suscripciones canceladas, facturas y anomalías obvias (como suscripciones activas duplicadas).
2. Clasificar el problema en un bucket antes de actuar, usando una tabla de casos típicos: suscripción personal duplicada (cancelar extras, considerar reembolso), intención real de equipo/multi-asiento (preservar asientos, aclarar modelo de facturación), pago fallido/checkout incompleto (recuperar vía portal o actualizar método de pago), falta de controles self-serve (dar acceso a portal, cancelación o facturas), o falla de producto/ruptura de confianza (reembolsar, disculparse, loguear el issue de producto).
3. Tomar primero la acción reversible más segura, en este orden: restaurar la gestión self-serve, arreglar el estado de facturación duplicado o roto, reembolsar solo el cargo afectado o duplicado, documentar la razón, y enviar un seguimiento breve al cliente. Si el arreglo requiere trabajo de producto, hay que separar la remediación inmediata al cliente del bug de producto o gap de workflow para el backlog.
4. Revisar gaps de producto del lado del operador: si el dolor del cliente viene de una superficie faltante (sin portal de facturación, sin visibilidad de uso/rate-limit, sin explicación de plan/asientos, sin flujo de cancelación, sin guardia contra suscripciones duplicadas), hay que señalarlo explícitamente como ítem de seguimiento para ECC o el sitio web, no solo como incidente de soporte.
5. Producir el handoff para el operador, cerrando con: resumen del estado del cliente, acción tomada, impacto en ingresos, texto de seguimiento a enviar, y el issue de producto/backlog a crear.

El formato de salida es un bloque de texto estructurado con las secciones: CUSTOMER (nombre/email, identificadores relevantes), BILLING STATE (suscripciones activas, estado de factura/renovación, anomalías), DECISION (clasificación del issue, por qué la acción es correcta), ACTION TAKEN (refund/cancel/portal/no-op), FOLLOW-UP (mensaje corto al cliente) y PRODUCT GAP (qué debería arreglarse en el producto o sitio).

El documento incluye ejemplos de buenas recomendaciones, como sugerir un portal de facturación en vez de un dashboard custom, identificar un checkout duplicado personal en vez de una compra real de equipo, o reembolsar solo el cargo duplicado manteniendo la suscripción activa restante y evaluando luego convertir al cliente a facturación organizacional.
