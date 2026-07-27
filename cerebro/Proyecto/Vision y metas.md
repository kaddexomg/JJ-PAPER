---
tags: [proyecto]
---

# Visión y metas

## Qué es JJ Paper

Papelería REAL en Venezuela, venta al detal y al mayor. El sistema es su tienda
online + su back-office completo: catálogo público, POS, cotizador, CRM (WhatsApp
y correo), inventario con conteo físico, delivery, comisiones de vendedores y
cuentas por pagar. Dueño coordina con Luis; el equipo NO es técnico: la interfaz
debe ser obvia, en español, con botones grandes y mensajes honestos.

## La meta grande

**Que toda la operación de la papelería viva en este sistema**, sin Excel sueltos
ni cuadernos: desde que el cliente pregunta por WhatsApp hasta que se repone el
stock del proveedor. Cada intercambio con un cliente debe quedar registrado en su
historial (por eso todo envío sale por el CRM propio y no por wa.me — ver
[[Envio de documentos]]).

## Principios de producto

1. **Registro antes que velocidad**: mejor que el mensaje quede en la cola del CRM
   a que salga por fuera y no quede rastro.
2. **Honestidad con el usuario**: si el servidor está apagado, se dice ("queda en
   cola"); si un documento no es fiscal, lo dice ("sin valor fiscal").
3. **El público no ve información interna**: stock exacto, SKU, costos — ver
   [[Modelo de seguridad]].
4. **Nada de cascarones**: una feature prometida funciona de punta a punta o no se
   entrega (ver [[Reglas de trabajo]]).
5. **Hardware humilde**: PCs viejas en la tienda → sin blur pesado en paneles,
   página `diag.html` en ES5, modo perf-low.

## Hacia dónde apuntamos (dirección, no backlog)

- Cerrar el ciclo fiscal: entidad factura propia con numeración secuencial real
  (hoy la numeración visible es Nº de control correlativo; ver [[Pendientes]]).
- Más automatización del CRM: seguimientos, reactivación, respuestas guiadas
  (base ya en [[Difusion]] y [[Correo]]).
- Catálogo 100% con foto y costo cargado (hay marcas con placeholder y costos
  faltantes en conteo — ver [[Inventario y conteo]]).
- Que cualquier modelo de IA pueda continuar el trabajo con este [[INICIO|cerebro]]
  sin depender de la memoria de una sola herramienta.

## Qué NO somos

- No es multi-tienda ni SaaS: es EL sistema de UNA papelería. No generalizar.
- No hay framework ni build del frontend a propósito (mantenible por cualquiera).
- No se factura fiscalmente: no fingir valor fiscal en documentos.

Relacionado: [[CONTEXTO]] · [[Historia]] · [[Pendientes]] · [[Arquitectura]] · [[Glosario]]
