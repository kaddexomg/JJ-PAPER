---
tags:
  - historia
  - arquitectura
  - consolidacion
  - jj-paper
---

# Consolidación Histórica y Arquitectónica de JJ PAPER

## 1. Resumen General del Proyecto
- **Negocio**: Papelería real en Venezuela (detal y mayor). Tienda online, POS, cotizador, CRM de WhatsApp y correo, inventario con conteo físico, delivery y comisiones.
- **Arquitectura**: 
  - **Frontend**: HTML/CSS/JS vainilla modular, sin frameworks complejos de compilación en cliente.
  - **Backend / Datos**: Supabase (`oeiuczltgdexwjjgquyq`) mediante clave anónima + RLS y RPCs.
  - **Servidor Local (`wa-server`)**: Aplicación Node.js en la PC de la tienda para despacho asíncrono de mensajes y correos mediante cola `pending`.

## 2. Hitos y Módulos Implementados Recientemente
- **Gestión de Clientes por Zonas y Vendedores**:
  - Procesamiento y conversión de los archivos fuente `.DOC` (`ZONA004.DOC`, `ZONA006.DOC`, `ZONA008.DOC`, `ZONA014.DOC`) de la carpeta `CLIENTES/` a un archivo CSV consolidado de **1,811 clientes** (`clientes_procesados_zonas.csv`).
  - **Asignación Automática**:
    - **Marianela**: Zona `008`
    - **Andreina**: Zona `014`
    - **Giovanni**: Zonas `006` y `004`
- **Panel de Administrador (Gestión Global)**:
  - Creación de `admin/clientes.html` y `assets/js/admin/aclients.js` para la administración global de carteras, importación masiva de CSV y distribución automática de vendedores.
- **Navegación Unificada (`sidenav.js`)**:
  - Integración robusta del enlace a **Clientes CRM** bajo la sección de Catálogo en el menú lateral común de administración.

## 3. Despliegue y Control de Versiones
- Sincronización completa con el repositorio remoto en GitHub y despliegue automático en producción mediante **Cloudflare Pages** (`jj-paper.pages.dev`).
- Documentación viva perpetuada en el baúl de Obsidian de JJ PAPER.
