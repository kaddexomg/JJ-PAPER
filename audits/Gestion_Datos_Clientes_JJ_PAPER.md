---
tags:
  - auditoria
  - datos
  - supabase
  - crm
---

# Auditoría de Gestión de Datos de Clientes en JJ PAPER

## 1. Estructura de Datos
- **`jjp_customers`**: Tabla principal de CRM donde se gestiona la cartera de vendedores (zonas, contactos, historial). La lógica está centralizada en `assets/js/vendedor/vcustomers.js`.
- **`jjp_clients`**: Tabla de "Clientes que confían en nosotros" (marquesina pública en el home).
- **Datos Legados**: Los listados históricos en formato `.DOC` (`ZONA004.DOC`, etc.) sirven como fuente de verdad para la carga manual y auditoría inicial de zonas.

## 2. Gestión de Clientes
- **Carga de Datos**: El sistema permite importar masivamente datos mediante archivos CSV o Excel a través de `vcustomers.js` (función `custImportFile`).
- **Persistencia**: Los datos se almacenan directamente en la base de datos Supabase (`jjp_customers`), garantizando persistencia y acceso multi-vendedor con políticas RLS (Row Level Security).
- **Zonas y Vendedores**: Definidos mediante mapeo (`ZONE_SELLER_MAP`) en el frontend, garantizando la segmentación según la zona asignada (Marianela, Andreina, Giovanni).

## 3. Resumen Técnico de Buenas Prácticas
- **Consolidación**: Se desaconseja el uso de archivos locales como fuente única de verdad para el sistema de ventas; estos deben migrarse a `jjp_customers` vía el importador del panel de vendedor.
- **Seguridad**: Se utiliza Supabase como backend único para evitar problemas de sincronización de datos entre dispositivos.
- **Auditoría**: Las funciones `jjp_*` gestionan la lógica sensible, mientras que el frontend asegura una experiencia unificada de edición y visualización.
