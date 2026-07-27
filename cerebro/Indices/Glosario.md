---
tags: [indice, glosario]
---

# Glosario

Términos del negocio y del código que aparecen sin explicación en el día a día.

| Término | Qué significa aquí |
|---|---|
| **Variante** | lo que realmente se vende: producto + marca, con su precio, costo, código y stock ([[Producto y variante]]) |
| **Kardex** | libro de movimientos de existencias (`jjp_stock_moves`): toda entrada/salida con su razón ([[Stock]]) |
| **Tally** | conteo acumulado del inventario físico, sumado por deltas ([[Inventario y conteo]]) |
| **Cruce** | dos productos distintos comparten un código de barras; se arregla en el control de conteo |
| **Cartera** | los clientes asignados a un vendedor (`seller_id`) ([[Cliente]]) |
| **Cliente libre** | cliente sin vendedor asignado; cualquiera puede "tomarlo" |
| **Lead** | contacto capturado por el chatbot antes de comprar |
| **Ficha** | 📤 mensaje con foto + reseña + enlace de compra de un producto ([[Envio de documentos]]) |
| **Hub de envío** | el menú 📤 que manda catálogo, lista, cotización, factura, recibo o estado |
| **Cola / outbox** | mensajes `pending` esperando que el servidor los despache ([[Cola de mensajes]]) |
| **Heartbeat / latido** | señal cada 20 s del servidor; el panel lo pinta 🟢 si tiene menos de 70 s ([[wa-server]]) |
| **Baileys** | librería que conecta WhatsApp sin API oficial (por eso el QR y el cuidado con los baneos) |
| **ptt** | *push to talk*: nota de voz de WhatsApp |
| **Bad MAC** | error de descifrado de Baileys; **continuo** = hay dos procesos del servidor ([[Incidentes]]) |
| **RLS** | *Row Level Security*: las reglas de Postgres que deciden qué fila ve cada usuario ([[Modelo de seguridad]]) |
| **RPC** | función de base de datos que el front llama por nombre (`jjp_*`) ([[Base de datos]]) |
| **anon / service_role** | claves de Supabase: la pública (limitada por RLS) y la del servidor (sin límites) |
| **BCV** | Banco Central de Venezuela: tasa oficial usada para los precios en bolívares ([[Dinero y tasas]]) |
| **P2P / USDT** | tasa de calle (Binance), referencia interna |
| **Pago Móvil** | pago bancario instantáneo por teléfono, muy usado en Venezuela |
| **RIF** | identificación fiscal del negocio o del cliente |
| **Nº de control** | correlativo que llevan las facturas formales; el nuestro **no tiene valor fiscal** |
| **Al mayor** | venta por volumen con precio negociado, normalmente vía [[Cotizacion]] |
| **AUDITO** | técnica de auditoría: trazar cada botón por su secuencia completa de cambios de estado ([[Guia maestra de auditoria]], bloque D) |
| **LAN / conteo offline** | contar inventario por WiFi local sin internet (puertos 8787/8788) |
| **perf-low** | modo de bajo consumo para las PCs viejas de la tienda |
| **Cascarón** | feature que se ve pero no funciona: prohibido entregarlas ([[Reglas de trabajo]]) |

Relacionado: [[CONTEXTO]] · [[Por tarea]] · [[Mapa de archivos]]
