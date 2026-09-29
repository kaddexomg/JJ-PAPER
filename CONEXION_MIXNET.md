# Guía de Conexión y Configuración: Servidor Local ⇄ MixNet / Mixer

Esta guía detalla la arquitectura de red y el funcionamiento del puente bidireccional entre el servidor de JJ Paper (`wa-server`) en la PC Supervisor y el facturador **MixNet** en la empresa.

---

## 🗺️ Topología de Red de la Empresa

```mermaid
graph TD
    subgraph Servidor JJ Paper ["PC Supervisor (192.168.0.172)"]
        WS[wa-server Node.js]
        MON[Monitor LAN :8787 / :8788]
        WA[WhatsApp Baileys + Outbox]
        EM[Gmail API + Campañas]
        MIX[Puente Mixer Bidireccional]
    end

    subgraph Servidor MixNet ["Servidor Facturación MixNet (192.168.0.185)"]
        DBF[Carpeta comp01 / Unidad M:]
        TAB1[(VICTAINV.DBF - Inventario)]
        TAB2[(MXCTAINV.DBF - Catálogo)]
        TAB3[(PED.DBF / MXRENPED.DBF - Pedidos)]
        TAB4[(PRESUP.DBF - Presupuestos)]
        DBF --> TAB1 & TAB2 & TAB3 & TAB4
    end

    subgraph Supabase Nube ["Supabase Multi-Proyecto"]
        DB_A[(Proyecto A: Core - jjp_orders, jjp_products, jjp_customers)]
        DB_B[(Proyecto B: Comunicación - jjp_wa_*, jjp_emails)]
    end

    WS <-->|Realtime & REST| DB_A
    WS <-->|Realtime & REST| DB_B
    MIX <-->|Lectura/Escritura SMB M:\comp01 o \\192.168.0.185\comp01| DBF
```

---

## 🔄 Funcionamiento de Integración Seguro ("Lectura Directa + Intercambio No Invasivo")

> Para la especificación técnica completa de tablas, campos, índices `.NTX` y nómina de MixNet, consultar el documento maestro:  
> 📄 [ARQUITECTURA_Y_COMPORTAMIENTO_MIXNET.md](file:///C:/Users/Supervisor/Desktop/JJ-PAPER/ARQUITECTURA_Y_COMPORTAMIENTO_MIXNET.md).

### 1. Pedidos (JJ Paper ⇄ MixNet)
* **JJ Paper ➔ MixNet (Canal Saliente No Invasivo)**:
  * Cada pedido aprobado en la Web, POS o Cotizador se registra en `jjp_orders`.
  * El puente exporta de inmediato `pedido_[NUMERO].csv` y `pedido_[NUMERO].txt` a las carpetas de intercambio compartidas (`M:\pedidos`, `M:\comp01`, etc.).
  * **PROHIBICIÓN ESTRICTA**: Está terminantemente prohibida la escritura binaria directa en los archivos `.DBF` de MixNet sin recomposición nativa de índices `.NTX`. La integración saliente se realiza exclusivamente por buzón de intercambio o importador nativo de MixNet.
  * Huella digital determinista (`computeDocFingerprint`) y filtros por origen (`source !== 'mixnet'`) previenen bucles de re-exportación.
* **MixNet ➔ JJ Paper (Canal Entrante de Solo Lectura)**:
  * El servidor lee de forma segura las tablas `MXENCPED.DBF` y `MXRENPED.DBF` para reflejar las ventas hechas en caja en tiempo real.
  * Si un pedido es facturado en MixNet, el módulo de facturas (`MXENCFAC.DBF`) sincroniza automáticamente el Nro de Factura y Nro de Control Fiscal SENIAT.

### 2. Cotizaciones y Presupuestos (JJ Paper ⇄ MixNet)
* **JJ Paper ➔ MixNet**:
  * Cada cotización de vendedor se deposita como archivo estructurado `cotizacion_[NUMERO].csv` y `.txt` en la bandeja de red.
* **MixNet ➔ JJ Paper**:
  * Lectura periódica de presupuestos emitidos en MixNet para seguimiento de ventas en `jjp_quotes`.

### 3. Productos, Precios y Stock (JJ Paper ⇄ MixNet)
* **MixNet ➔ JJ Paper**:
  * Lee `VICTAINV.DBF` y `MXCTAINV.DBF` para actualizar en tiempo real el stock físico y los precios de venta en `jjp_products` y `jjp_product_variants`.
  * Respaldo HTTP: Si la suite de bajo consumo de `archivos-pc` está activa en el puerto 3000 (`http://192.168.0.185:3000`), el servidor sincroniza productos vía API REST.
* **JJ Paper ➔ MixNet**:
  * Sincroniza `catalogo_jjpaper.csv` y `productos_jjpaper.csv` directamente en la unidad de red.

---

## 🚀 Inicio Automático y Segundo Plano en `Supervisor-Pc`

El servidor está preparado para funcionar **100% en segundo plano** sin ventanas de consola visibles y con auto-reinicio ante errores:

1. **Instalación en la PC del Supervisor (`192.168.0.172`)**:
   * Ejecutar: `INSTALAR-INICIO-AUTOMATICO.bat` dentro de `wa-server`.
   * El servicio queda enlazado en `shell:startup` y arrancará con Windows.
2. **Supervisión de Salud**:
   * Auto-diagnóstico: si ocurre un fallo de red o socket, el servidor se reinicia automáticamente en 2 segundos.
   * Ejecutar `ESTADO-SERVIDOR.bat` para verificar PID, memoria RAM y rutas activas.

---

## 🌐 Endpoints de Red LAN Local (Disponibles en la red)

* **Monitor de Salud y Cuotas**: `http://192.168.0.172:8787/lan/monitor`
* **Pedidos Recientes (JSON)**: `http://192.168.0.172:8787/lan/mixnet/pedidos`
* **Pedidos Recientes (CSV)**: `http://192.168.0.172:8787/lan/mixnet/pedidos?format=csv`
* **Cotizaciones Recientes (JSON)**: `http://192.168.0.172:8787/lan/mixnet/cotizaciones`
* **Cotizaciones Recientes (CSV)**: `http://192.168.0.172:8787/lan/mixnet/cotizaciones?format=csv`
* **Catálogo de Productos para MixNet (JSON)**: `http://192.168.0.172:8787/lan/mixnet/productos`
* **Catálogo de Productos para MixNet (CSV)**: `http://192.168.0.172:8787/lan/mixnet/productos?format=csv`
* **Estado del Enlace MixNet**: `http://192.168.0.172:8787/lan/mixnet/status`
