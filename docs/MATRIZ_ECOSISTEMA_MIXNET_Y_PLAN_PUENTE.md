# 🏛️ MATRIZ DE CONTEXTO SOBERANO: ECOSISTEMA INTEGRAL MIXNET ERP Y PLAN DE IMPLEMENTACIÓN DEL PUENTE BIDIRECCIONAL

> **Proyecto:** JJ Paper C.A. — Integración Soberana PC Supervisor / Tienda ⇄ VPS Ubuntu  
> **Fecha de Consolidación:** 06 de Noviembre de 2026  
> **Propósito:** Documento maestro de contexto operacional y arquitectura para erradicar llamadas ciegas, dependencias de terminales y bloqueos en red local.

---

## 1. 🏢 Naturaleza Operacional Real de JJ Paper

JJ Paper **no es una tienda minorista con caja registradora de autoservicio**. Es una **distribuidora mayorista y corporativa B2B de papelería, suministros de oficina, maquinaria y embalaje**, orientada al despacho por bulto a comercios revendedores (librerías, quincallas, bazares) y consumo continuo a empresas e instituciones (clínicas, colegios, almacenes).

En la red LAN de la tienda (`192.168.0.185`, recurso compartido `M:\MIX11\comp01`), operan simultáneamente 4 puestos especializados:

```
[Puesto 1: Facturación Fiscal SENIAT] ──┐
[Puesto 2: Administración y Cobranzas] ──┼──> [SMB Red LAN] ──> [M:\MIX11\comp01]
[Puesto 3: Compras y Proveedores]     ──┤                       (Tablas DBF + Índices NTX)
[Puesto 4: 5 Asesores de Ventas]      ──┘
 (Luis 002, Yovanni 004/006, Marianela 008, Andreina 014, Keyder 005/010)
```

Cualquier bloqueo de archivo, retención prolongada de descriptores o colisión en los archivos `.DBF`/`.NTX` congela las pantallas de estos 4 puestos y detiene la facturación y el despacho de la empresa.

---

## 2. 🗄️ Diccionario Completo del Ecosistema de Archivos MixNet (`comp01`)

El funcionamiento sano del sistema requiere interactuar con el tejido completo de archivos conectados:

| Categoría | Archivo DBF | Índices `.NTX` B-Tree | Función Operativa y Contenido |
| :--- | :--- | :--- | :--- |
| **Contadores Maestros** | `MXNUMCOT.DBF`<br/>`MXNUMPED.DBF`<br/>`MXNUMFAC.DBF`<br/>`MXNUMREC.DBF` | *Sin índice* (1 registro de 8 bytes) | **Correlativos numéricos oficiales sagrados.** Contienen el próximo número secuencial a emitir en la tienda. |
| **Ventas / Cotizaciones** | `MXENCCOT.DBF`<br/>`MXRENCOT.DBF` | `MXRECZX1.NTX` (`NUMCOT`)<br/>`MXRENCOT.NTX` (`NUMCOT+ITEM`) | Cabeceras y renglones de cotizaciones emitidas a clientes. Registra vendedor (`CODVEN`), total USD y tasa BCV. |
| **Ventas / Pedidos** | `MXENCPED.DBF`<br/>`MXRENPED.DBF` | `MXENPEX1.NTX` (`NUMPED`)<br/>`MXENPEX2.NTX` (`CLIENTE`)<br/>`MXRENPED.NTX` (`NUMPED+ITEM`) | Pedidos en firme aprobados para despacho. Es el paso previo a la facturación fiscal. |
| **Facturación Fiscal** | `MXENCFAC.DBF`<br/>`MXRENFAC.DBF` | `MXENFAC1.NTX` (`NUMFAC`)<br/>`MXREFAC1.NTX` (`NUMFAC+ITEM`) | Facturas fiscales definitivas SENIAT emitidas por el puesto de facturación. Su emisión marca el pedido como facturado (`FA`). |
| **Fichas de Clientes** | `MXCTACLI.DBF` | `MXCTACLI.NTX` (`CODCLI`)<br/>`MXCTAC2.NTX` (`NOMCLI`)<br/>`MXCTAC3.NTX` (`CIF` / RIF) | Directorio de clientes con razón social, RIF/cédula, dirección fiscal, teléfono y límite de crédito comercial. |
| **Catálogo y Precios** | `MXCTAINV.DBF` | `MXCTAIN1.NTX` (`ITEM`)<br/>`MXCTAIN2.NTX` (`DESCRIP`) | Maestro de artículos, SKUs, descripciones oficiales, marcas, categorías y listas de precios mayoristas/bulto. |
| **Stock de Almacén** | `VICTAINV.DBF` | `VICTAIN1.NTX` (`ITEM`) | **Existencia física viva en tiempo real.** Muestra stock físico, mercancía comprometida en pedidos y saldo disponible para despacho. |
| **Proveedores** | `MXCTAPRO.DBF`<br/>`MXENCOCP.DBF` | Índices de proveedor y orden de compra | Proveedores registrados, condiciones comerciales y órdenes de compra de mercancía nacional e importada. |
| **Cuentas x Cobrar** | `MXMOVCLI.DBF` | Índices de movimientos de clientes | Historial vivo de cargos (facturas), abonos (pagos recibidos), saldos deudores y días de crédito de cada cliente. |
| **Cuentas x Pagar** | `MXMOVPRO.DBF` | Índices de movimientos proveedores | Cuentas por pagar a fábricas y distribuidores mayoristas de papel y suministros. |
| **Nómina Asesores** | `MXCTAVEN.DBF` | Índice por código de vendedor | Códigos de vendedor autorizados (`002`, `004`, `006`, `008`, `014`, `005`, `010`). Define la autoría de ventas y comisiones. |

---

## 3. 🛡️ Los 5 Principios de Ingeniería Definitivos

### Principio 1: Lectura Efímera sin Retención (`Shared No-Lock`)
- **Problema Anterior:** Mantener descriptores abiertos o hacer consultas masivas continuas bloqueaba el recurso compartido SMB de Windows.
- **Regla:** Toda lectura de archivos DBF se hace con banderas de compartición total (`FILE_SHARE_READ | FILE_SHARE_WRITE`). El proceso abre el archivo, lee en memoria RAM la cabecera y el delta de registros en menos de **20 milisegundos**, y **CIERRA el archivo inmediatamente**. Cero retención de sockets de archivo.

### Principio 2: Erradicación del Polling Ciego y Sincronización por Lote (Batch Watermark)
- **Problema Anterior:** `setInterval(3000)` martillando peticiones HTTP individuales que se encolaban, colapsaban la cola interna de Node.js y generaban timeouts artificiales mientras el internet estaba perfecto.
- **Regla:** 
  1. El puente mantiene una **Marca de Agua (Watermark)** con el último serial sincronizado (`last_cot_serial`, `last_ped_serial`).
  2. Como los números de MixNet son estrictamente correlativos secuenciales, si el correlativo subió de `#00053618` a `#00053650`, el puente sabe exactamente que hay 32 cotizaciones nuevas.
  3. Lee esas 32 cotizaciones en un solo pase de memoria, las empaqueta en **UN SOLO objeto JSON** y las envía al VPS.
  4. PostgreSQL en el VPS ejecuta la asociación de clientes y la inserción de cabeceras y renglones en **1 sola transacción SQL interna** en menos de 100 ms. Cero consultas previas individuales.

### Principio 3: Canal Persistente Bidireccional (WebSocket WSS)
- **Problema Anterior:** 28.000 peticiones HTTPS efímeras al día con renegociación constante de certificados SSL y latencia.
- **Regla:** La PC de la tienda abre **una sola conexión WebSocket encriptada permanente** con el VPS (`wss://...`). 
  - La conexión vive abierta con pings ultraligeros cada 30 segundos.
  - Cuando un vendedor en la web presiona *"📥 Insertar en MixNet"*, la orden baja por el WebSocket en **15 milisegundos**.
  - Si hay un microcorte de internet en la tienda, el WebSocket reconecta de forma transparente con retroceso exponencial (`backoff`), sin acumular colas rotas.

### Principio 4: Linaje Estricto de Documentos (Erradicación Absoluta de Duplicados)
- **Problema Anterior:** Riesgo de re-inyectar a MixNet documentos que ya nacieron en MixNet, duplicando ventas en el ERP físico.
- **Regla:** Cada documento posee una propiedad inmutable de Linaje:
  - **`source = 'mixnet'`**: Nació en el ERP físico. Se muestra en la web para consulta, trazabilidad y CRM. El botón "📥 Insertar en MixNet" **está inhabilitado y bloqueado** con la leyenda: `[Nativo MixNet #00053618]`.
  - **`source = 'web'`**: Nació en la web / cotizador. Es elegible para inyección. Al hacer clic en "Insertar", el puente toma el correlativo oficial de `MXNUMPED`/`MXNUMCOT`, inyecta el registro en el DBF, actualiza los `.NTX`, y actualiza el documento en la web a: `[Inyectado en MixNet: #00112945]`, bloqueando el botón permanentemente.
  - El puente ignora en sus barridos posteriores cualquier documento cuyo serial ya coincida con una inyección previa exitosa.

### Principio 5: Persistencia como Servicio Nativo de Windows (`services.msc`)
- **Problema Anterior:** El proceso corría en consolas PowerShell interactivas (que morían al cerrar la ventana) o en accesos directos de `Startup` (que no arrancaban si nadie iniciaba sesión en la PC).
- **Regla:** El demonio local se instala como un **Servicio del Sistema Operativo Windows** (`Automatic`). Arranca al encender la computadora antes de que nadie ingrese su contraseña, corre en segundo plano de forma silenciosa y el propio kernel de Windows lo vigila y reinicia automáticamente en 5 segundos si llegara a tener un fallo.

---

## 4. 🗺️ Hoja de Ruta Paso a Paso para la Próxima Sesión

```
   FASE 1: Saneamiento y Erradicación de Deuda Técnica en Repositorio
   ├── 1.1 Eliminar definitivamente 'supabase-client.js' y reemplazarlo por 'vps-client.js'.
   ├── 1.2 Implementar 'http.Agent' con keep-alive real y control de backpressure.
   └── 1.3 Implementar la lógica de Marcas de Agua (Watermarks) y paquetes por lote (Batch).

   FASE 2: Blindaje de Interfaz Web y Control de Linaje
   ├── 2.1 Modificar la vista de cotizaciones y pedidos en admin/ y vendedor/ para evaluar 'source'.
   ├── 2.2 Bloquear el botón "📥 Insertar en MixNet" para cualquier documento con source === 'mixnet'.
   └── 2.3 Añadir badges visuales transparentes: [Nativo MixNet] vs [Inyectado Web #XXXXX].

   FASE 3: Canal Persistente WebSocket (VPS ⇄ PC Tienda)
   ├── 3.1 Activar el endpoint WSS en el servidor central del VPS (manejado por PM2).
   └── 3.2 Integrar el cliente de reconexión automática en el agente de la tienda.

   FASE 4: Micro-Conector Quirúrgico de Escritura e Índices
   ├── 4.1 Validar lectura atómica compartida de MXNUMCOT / MXNUMPED.
   ├── 4.2 Inserción binaria dBase III de longitud fija en latin1 con respaldo sellado .BAK previo.
   └── 4.3 Actualización inmediata de los árboles B-Tree (.NTX) para visibilidad en las 5 máquinas.

   FASE 5: Empaquetado como Servicio de Windows Nativo
   ├── 5.1 Generar el script desatendido de registro en services.msc.
   └── 5.2 Configurar la directiva de recuperación automática ante fallas (Restart on Failure).
```

---

> [!NOTE]
> Este documento queda como el estándar arquitectónico inmutable para las sesiones posteriores. Ningún cambio de código se ejecutará sin contrastar previamente contra los 5 principios aquí definidos.
