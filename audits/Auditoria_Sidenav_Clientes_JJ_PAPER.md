---
tags:
  - auditoria
  - ui
  - sidenav
  - admin
---

# Auditoría de la Barra Lateral (Sidenav) y Enlace Clientes CRM en JJ PAPER

## 1. Análisis del Componente `sidenav.js`
- **Fuente Única de Verdad**: El archivo `assets/js/admin/sidenav.js` es el encargado de construir dinámicamente la barra lateral (`aside-nav`) tanto para el panel de administración como para el de vendedores.
- **Inclusión de Clientes CRM**: Dentro del arreglo `ADMIN_NAV`, el enlace `{ href: 'clientes.html', ico: '👥', label: 'Clientes CRM' }` está correctamente definido dentro del grupo de `Catálogo`.

## 2. Hallazgo y Verificación
- El enlace estaba implementado y operativo en `sidenav.js`. Sin embargo, en vistas individuales del admin que no cargaban `sidenav.js` o que mantenían un menú estático en su HTML (como sucedía en algunas páginas heredadas), el enlace podía no verse reflejado de forma uniforme.
- Con la unificación a través de `sidenav.js`, todas las páginas del panel de administración (`index.html`, `clientes.html`, `vendedores.html`, etc.) inyectan la barra lateral común garantizando que **"Clientes CRM"** aparezca siempre visible bajo la sección de Catálogo.

## 3. Resumen de Buenas Prácticas
- **Componentes Modulares**: Uso de scripts centralizados para evitar duplicación de código en la UI de navegación.
- **Consistencia Visual**: Sincronización automática de clases activas (`.on`) según la ruta actual.
- **Documentación Viva**: Registro en el cerebro Obsidian.
