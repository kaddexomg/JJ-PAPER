# Estado de Progreso Guardado: Sesión 26 de Octubre de 2026

> **Fecha:** 26 de Octubre de 2026  
> **Motivo de la Pausa:** Reinicio de la PC solicitado por el usuario.  
> **Comando de reanudación:** El usuario escribirá `"continua"` al volver a abrir el chat.

---

## 1. Lo que ya está completado y guardado en disco

1. **Hoja de Prueba del Catálogo Impreso (`catalogo_impreso.html` y `dist/catalogo_impreso.html`):**
   * Botón `🧪 Hoja de Prueba` en barra superior y opción en el selector de tandas: `🧪 Hoja 1 de Prueba (Solo Págs 1 y 2 · Calibración Dúplex)`.
   * Modal guiado interactivo `#testSheetModal` con botones dedicados para imprimir Frente (Pág 1) y Reverso (Pág 2).

2. **Filtro Anti-Contaminación de Clientes y Datos de Prueba:**
   * Función `isTestEntity()` implementada en:
     - `lan-daemon/daemon.js`
     - `jj-mixnet-agent/sync-documents.js`
     - `jj-mixnet-agent/client-reconciler.js`
   * Filtra y omite automáticamente cualquier cotización, pedido o cliente que contenga `e2e`, `prueba`, `test`, `verificacion`, `mps`, `dummy` o `cliente prueba`, garantizando que **jamás se inyecten ni alteren MixNet**.

3. **Módulo de Usuarios y Permisos de MixNet (`MXUSUAR.DBF`):**
   * Creado `jj-mixnet-agent/mixnet-usuar.js` con `getMixnetUsers()` y `updateMixnetUserPermissions()` con snapshot preventivo y rollback automático.
   * Conectado a `jj-mixnet-agent/agent.js` (rutas HTTP `/users` y `/users/permissions`) y `task-runner.js` (acciones `list_users` y `update_user_permissions`).
   * Interfaz agregada en `admin/mixnet.html` y `dist/admin/mixnet.html`: Tarjeta "👥 Usuarios y Permisos de GemixNet ERP", botón `🔄 Leer Usuarios desde MixNet` y modal de edición de permisos.

4. **Diagnóstico del Puerto 8790 e IP LAN:**
   * `admin/mixnet.html` actualizado para consultar tanto `127.0.0.1:8790` como la IP configurable del Servidor Central (`192.168.0.185:8790`) con botón `⚙️ Cambiar IP` y guía interactiva `¿Cómo encenderlo?`.

---

## 2. Lo que se debe retomar inmediatamente al decir "continua"

**El ajuste de calibración de impresión Dúplex para el giro 180° "tipo volante" y alineación a contraluz:**

1. **Problema identificado:**
   * El usuario descubrió que al sacar la hoja de su impresora, debe darle un giro de 180° "tipo volante" para que la otra cara salga al derecho.
   * Al hacer ese giro físico de 180°, el lomo que en Cara 1 estaba a la izquierda, en el alimentador de papel queda a la izquierda, pero el código CSS actual de la Cara 2 (`even-sheet`) ponía el lomo a la derecha (modo libro estándar).
   * Por eso, al poner la hoja a contraluz, los huecos y márgenes quedan en lados opuestos o desalineados.

2. **Solución a aplicar en `catalogo_impreso.html`:**
   * Agregar el selector de **Modo de Giro**:
     - `🔄 Giro 180° Tipo Volante (Tu impresora)`: Alimenta el lomo de Cara 2 en el mismo lado izquierdo para que coincida exactamente con Cara 1.
     - `📖 Giro Libro Estándar`: Lomo alternado (Izq / Der).
   * Agregar el **Calibrador Milimétrico en Vivo a Contraluz** (Offset X y Offset Y en milímetros con botones `[- 1mm]` y `[+ 1mm]` y persistencia en `localStorage`) para que el usuario pueda calibrar el desvío físico del rodillo de su impresora y los huecos coincidan 100% exactos a contraluz.
   * Actualizar el modal de Hoja de Prueba con las instrucciones del giro tipo volante y la herramienta de micro-calibración.
   * Copiar a `dist/catalogo_impreso.html`.
