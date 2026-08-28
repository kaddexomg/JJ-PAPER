---
tags: [clientes, zonas, crm, administracion, vendedores]
---

# Gestión de Clientes, Asignación por Zonas y Panel Admin en JJ Paper

> **Resumen Ejecutivo:** Documentación histórica y técnica de la implementación de la cartera de clientes segmentada por zonas (004, 006, 008, 014), la asignación automática a vendedores, la importación masiva desde reportes `.DOC` y la integración en la barra lateral del Administrador.

---

## 1. Mapeo de Zonas y Vendedores

Para optimizar la gestión comercial de la papelería en Venezuela, los clientes han sido clasificados y distribuidos en carteras cerradas según su zona geográfica/grupo.

> **Fuente de verdad:** los reportes por zona `CLIENTES/ZONA004.DOC`, `ZONA006.DOC`, `ZONA008.DOC`, `ZONA014.DOC`.
> Cantidades recargadas el 27-08-2026 (ver [[2026-08-27]]). **Giovanni maneja 2 zonas (004 y 006), por lo tanto es el que más clientes tiene.**

| Zona / Grupo | Vendedor Asignado | Cantidad de Clientes | Identificador Visual / Badge |
|---|---|---|---|
| **Zona 008** | **Marianela** | 494 registros | Naranja (`#e67e22`) |
| **Zona 014** | **Andreina** | 540 registros | Morado (`#9b59b6`) |
| **Zona 006** | **Giovanni** | 433 registros | Verde (`#2ecc71`) |
| **Zona 004** | **Giovanni** | 121 registros | Verde (`#2ecc71`) |
| *Total* | *Equipo de Ventas* | **1,588 clientes** | — |

### IDs de vendedores (Supabase operativo `czzvsqnmxtjzqzioknnn`)
- **Marianela** → `d9608291-1363-4790-a7b0-0d6fd426564f` (zona 008)
- **Andreina** → `b0cd93c5-e2f0-4322-9d35-e374109d284f` (zona 014)
- **Giovanni (Yovanni Araujo)** → `95d5ad44-e844-4f4f-a9d0-2db7d162c8c6` (zonas 004 y 006)

---

## 2. Arquitectura de Datos y Archivos Fuente

- **Archivos de Origen**: Reportes binarios en la carpeta `CLIENTES/` (`ZONA004.DOC`, `ZONA006.DOC`, `ZONA008.DOC`, `ZONA014.DOC`).
- **Archivo Consolidado CSV**: `clientes_procesados_zonas.csv` generado en la raíz del repositorio, conteniendo columnas normalizadas: `code`, `name`, `zone`, `seller`, `phone`, `rif`, `email`, `city`.
- **Tabla en Supabase**: `jjp_customers` (proyecto `oeiuczltgdexwjjgquyq`), equipada con políticas RLS para que cada vendedor gestione exclusivamente su cartera y el Administrador tenga control global.

---

## 3. Implementación Frontend y Panel Admin

1. **Gestión Global de Clientes (Admin)**: Creado en `admin/clientes.html` y `assets/js/admin/aclients.js`. Permite al administrador visualizar toda la base de datos, filtrar por zona, crear/editar registros y realizar importación masiva con distribución automática.
2. **Barra Lateral Unificada (Sidenav)**: Integrado el acceso a **Clientes CRM** en el archivo centralizado `assets/js/admin/sidenav.js` bajo el grupo de **Catálogo**, asegurando visibilidad en todas las vistas de administración.

---

## 4. Referencias y Enlaces del Cerebro

- Relacionado con: [[Cliente]], [[Sesion y roles]], [[Vision y metas]], [[INICIO]], [[Mapa de archivos]].
