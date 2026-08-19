---
tags: [concepto, entidad]
---

# Dinero y tasas

Venezuela: se **piensa en dólares** y se **cobra en bolívares**. Toda cifra del
sistema nace en USD y se convierte a Bs al momento de mostrarla.

## Las cuatro tasas

| Clave en `jjp_settings` | Qué es | Uso |
|---|---|---|
| `exchange_rate` | BCV (oficial) | precios al público y documentos |
| `usdt_rate` | Binance P2P (real de calle) | referencia interna |
| `rate_eur` | Euro BCV | referencia |
| `default_margin_pct` | margen por defecto | sugerencia de precio desde costo |

Se refrescan cada hora: el [[wa-server]] (`rates.js`) las trae y un `pg_cron` de
respaldo hace lo mismo. Historial en `jjp_fx_rates` (para saber a qué tasa se
vendió algo).

## La tasa del vendedor (jjp_seller_settings)

Cada vendedor puede fijar **su propia tasa del día** desde `vendedor/ajustes.html`
(clave `rate_usd`). Se guarda en la tabla `jjp_seller_settings` y se aplica en
TODO su panel: POS, cotizador y catálogo PDF. `getRate()` en `config.js` la
respeta automáticamente (`APP.SELLER_RATE`); si el vendedor no la fija, se usa la
tasa oficial BCV. El botón "Consultar tasas hoy" trae BCV + Binance + Euro con
el mismo `fetchRates()` del admin. Ver `sql/2026-08-19-seller-settings.sql`.

## Cómo se usa en el código

En `assets/js/config.js`: `toBs(usd)` convierte, `fmtPrice(usd)` formatea en
dólares, `fmtBs(usd)` en bolívares. **Nunca hardcodear una tasa**: siempre pasar
por estas funciones, porque leen el valor vivo.

## Implicaciones que se olvidan

- Una [[Cotizacion]] enviada ayer puede no valer hoy: por eso el PDF dice
  *"precios sujetos a cambio según la tasa del día"*.
- La factura desglosa **IVA 16% hacia atrás** (el precio ya lo incluye) con
  alícuota por línea, y declara que **no tiene valor fiscal**
  ([[Envio de documentos]]).
- Los precios de venta viven en la variante, no en el producto
  ([[Producto y variante]]); `admin/pricing.js` permite recalcular en masa desde
  costo + margen + tasa.
- El **envío no comisiona**: al calcular la comisión del vendedor se resta el fee
  de [[Delivery]].
- Los datos de pago (Pago Móvil y transferencia) están en [[Configuracion]] y se
  muestran en el checkout y en los documentos.

## Al auditar

Totales de [[Pedido]]: líneas + envío − descuento = total. Diferencias de
centavos son redondeo; diferencias grandes son 🔴 (bloque B de la
[[Guia maestra de auditoria]]).

Relacionado: [[Pedido]] · [[Cotizacion]] · [[Delivery]] · [[Configuracion]]
