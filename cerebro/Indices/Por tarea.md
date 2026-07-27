---
tags: [indice, recetas]
---

# Por tarea — "quiero hacer X"

> Rutas de lectura y pasos ya trazados para los trabajos que más se repiten.
> Antes de cualquiera: [[CONTEXTO]] y la regla 1 de [[Reglas de trabajo]]
> (confirmar el plan).

## Agregar un campo a un producto

Lee [[Producto y variante]]. Decide si el campo es del **producto** o de la
**variante** (si cambia por marca, es de la variante). Tocarás:
`admin/products.js` (formulario y guardado), `catalog.js` / `product-modal.js`
(mostrarlo), y evalúa si debe salir en la [[Envio de documentos|ficha]] y en el
PDF (`doc-engine.js`). Verifica que no sea información interna
([[Modelo de seguridad]]).

## Agregar un tipo de documento enviable

Lee [[Envio de documentos]]. Añade la entrada en `SEND_DOCS` de `send-hub.js`
(con `label`, `hint`, `needs`, `build`, `texto`, `asunto`) y, si necesita un PDF
nuevo, la plantilla en `doc-engine.js`. **No** inventes otro camino de envío: usa
`sendPorWhatsApp` / `sendPorCorreo` ([[Cola de mensajes]]).

## Crear una página nueva de staff

1. Copia la estructura de una existente (p. ej. `vendedor/consulta.html`).
2. Scripts **en orden**: supabase → `config.js` → `toast.js` → `admin/auth.js` →
   `admin/sidenav.js` → tus módulos. Con `?v=` actualizado.
3. Llama `initSellerPage()` (vendedor) o la guarda de admin ([[Sesion y roles]]).
4. **No** escribas el sidebar en el HTML: agrégalo al array de `sidenav.js`.
5. Revisa accesibilidad y mobile (bloque F de la [[Guia maestra de auditoria]]).

## Tocar algo del flujo de venta

Lee [[Pedido]] y [[Cotizacion]] **completas** antes. Checklist obligatorio:
`variant_id` sobrevive, el kardex se escribe, los contadores de [[Cliente]] no se
duplican, el fee de [[Delivery]] se conserva y la comisión lo excluye. Después,
corre el bloque B de la [[Guia maestra de auditoria]].

## Cambiar algo del servidor

Lee [[wa-server]]. Recuerda: es producción. Guardia anti doble-arranque en
cualquier watchdog ([[Incidentes]]). Al terminar, **reiniciar el proceso** y
comprobar el arranque sano (sesión `connected`, outbox, correo, vigilante,
latidos). Di siempre qué no pudiste probar.

## "Un mensaje no le llegó al cliente"

1. ¿Servidor 🟢? (heartbeat < 70 s en el panel).
2. ¿La sesión de WhatsApp está `connected`? ¿La cuenta de correo verificada?
3. Mira el `status` y el `error` de la fila en la cola ([[Cola de mensajes]],
   sección Diagnóstico; consultas en el bloque C de la auditoría).
4. Revisa los logs del servidor.

## "El stock no cuadra"

Lee [[Stock]]. Busca pedidos `pagado` sin kardex, líneas sin `variant_id`, conteos
aplicados dos veces (hay bitácora y `jjp_count_revert`). **No corrijas números a
mano sin autorización** ([[Reglas de trabajo]], regla 6).

## Auditar el proyecto

[[Guia maestra de auditoria]] — 9 bloques. Empieza leyendo [[Incidentes]] e
[[Historial de auditorias]] para no repetir trabajo ya hecho.

## Publicar cambios

Commit en español, `git push` a `main` → Cloudflare despliega solo
([[Configuracion]]). Si creaste una carpeta interna, **exclúyela en `build.sh`** o
se publicará al mundo.

## Retomar el proyecto después de un tiempo

[[CONTEXTO]] → [[Historia]] (qué pasó) → [[Pendientes]] (qué falta) →
[[Incidentes]] (qué no repetir).

Relacionado: [[Mapa de archivos]] · [[Glosario]] · [[INICIO]]
