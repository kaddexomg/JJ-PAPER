# CONTEXTO DEL PROYECTO: ANTIGRAVITY WIN7 AGENT (MIXNET ERP)
**Fecha:** 07 de Octubre de 2026
**Estado:** Empaquetado y Listo (antigravity-win7-LISTO.zip)

## 1. ¿Qué se construyó?
Se creó un entorno agéntico completo compatible con Windows 7 y Node.js 13+ (cero dependencias NPM) para administrar el sistema MixNet ERP de JJ PAPER.
Ubicación del código fuente: `C:\Users\PC\Desktop\JJ PAPER\antigravity-win7-agent`

### Componentes Principales:
*   **server.js (El Backend/Motor):**
    *   Implementa lectura y *ESCRITURA* directa a archivos `.DBF` (MixNet).
    *   Pool de rotación automática para 9 API Keys de Gemini.
    *   Actualizado para usar el modelo `gemini-3.8-flash` (ya que 2.0 y 1.5 fueron deprecados por Google).
    *   Expone una API HTTP en el puerto 3300 (`/api/chat`, `/api/status`, `/api/mixnet/...`).
*   **public/index.html (El Frontend/UI):**
    *   Interfaz gráfica moderna estilo "Antigravity".
    *   Conectada 100% al backend usando XHR (compatible con navegadores antiguos de Win7).
    *   Contiene pestañas para el Chat del Agente, Explorador de MixNet, Visor de Logs y Estado de API Keys.
*   **INICIAR-AGENTE.bat (El Lanzador):**
    *   Inicia el servidor Node.js.
    *   *ÚLTIMA MODIFICACIÓN:* Se agregó `start http://localhost:3300` para que abra el navegador automáticamente y evite que el usuario se quede mirando la consola negra pensando que es una terminal interactiva.

## 2. Problema Resuelto (Última Interacción)
El usuario reportó que "solo veía pantallas rotas" y un "terminal esperando comandos". 
*Explicación:* El usuario estaba intentando tipear instrucciones directamente en la ventana de CMD de Windows que levanta el servidor, en lugar de usar el navegador web.
*Solución:* Se actualizó el `.bat` para abrir el navegador web automáticamente en `localhost:3300` y dirigir al usuario a la UI gráfica real. Se re-empaquetó el ZIP.

## 3. Servidor de Descarga LAN
Se dejó un pequeño servidor puente en la IP LAN de esta PC (puerto 8080) para que la máquina Windows 7 pueda descargar el archivo ZIP fácilmente accediendo a: `http://192.168.1.15:8080/`

## 4. Próximos Pasos para el Siguiente Agente
1. Confirmar con el usuario si logró descargar el ZIP en la PC Windows 7, ejecutar el `.bat` y si la interfaz web le cargó correctamente.
2. Si el usuario pide probar la edición DBF, recordarle pedir al agente tareas como: "Modifica el campo X del registro Y en la tabla Z".
3. Si ocurren errores de conexión, verificar si la unidad `M:\` está montada correctamente en el entorno Win7.
