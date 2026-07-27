---
tags: [concepto, entidad]
---

# Cliente

**Tabla**: `jjp_customers` · **La entidad más transversal del sistema**: aparece en
ventas, chat, correo, difusión, comisiones y en la ficha de producto.

## De dónde nace un cliente (5 puertas)

| Puerta | Cómo | Nota |
|---|---|---|
| Checkout público | al comprar, con sus datos | [[Pedido]] |
| Chatbot del sitio | capta nombre + teléfono al abrir (`jjp_capture_lead`) | [[Catalogo publico]] |
| Panel vendedor | alta manual o importación Excel/CSV | [[Ventas y cotizaciones]] |
| WhatsApp entrante | el server enlaza el chat por teléfono | [[CRM WhatsApp]] |
| Correo entrante | enlaza por dirección de correo | [[Correo]] |

Por eso hay **deduplicación**: teléfono único, y la importación busca por teléfono
o correo antes de insertar.

## Qué guarda

Identidad (`name`, `phone`, `email`, `rif`, `city`, `address`, `notes`),
propiedad (`seller_id` — de quién es la cuenta) e historial
(`total_orders`, `total_usd`, `last_order_at`).

> ⚠️ Los contadores se recalculan de forma **idempotente**. Hubo doble conteo por
> sumarlos en dos caminos distintos ([[Incidentes]]). Si tocas el flujo de pedidos,
> no vuelvas a sumar "a mano".

## Quién lo ve (RLS)

El vendedor ve **su cartera + los clientes sin dueño**; puede "tomar" uno libre.
El admin ve todo. Nada de esto es visible para `anon`. Ver [[Sesion y roles]].

## Dónde vive en el código

- Cartera y CRUD: `assets/js/vendedor/vcustomers.js`
- Ficha 360° dentro del chat: `assets/js/wa/wa-chat.js`
- Buscador al enviar una ficha: `assets/js/ficha-producto.js`
- Selección en POS/cotizador: `pos.js`, `vquotes.js` (parámetro `?cliente=<id>`)
- Enlace automático al encolar mensajes: `assets/js/send-hub.js`

## Regla de oro

**Todo lo que se le manda a un cliente debe quedar en su historial.** Por eso los
envíos salen por la [[Cola de mensajes]] con `customer_id`, y no por `wa.me`
suelto ([[Envio de documentos]]).

Relacionado: [[Pedido]] · [[Cotizacion]] · [[CRM WhatsApp]] · [[Difusion]] · [[Ventas y cotizaciones]]
