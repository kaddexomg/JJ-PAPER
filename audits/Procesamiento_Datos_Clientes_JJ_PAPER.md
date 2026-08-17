---
tags:
  - auditoria
  - python
  - exportacion
  - crm
---

# Procesamiento y Exportación Final de Clientes por Zonas (JJ PAPER)

## 1. Ejecución del Pipeline de Extracción
- Se ejecutó el script automatizado en Python para procesar la totalidad de los archivos fuente en la carpeta `CLIENTES/` (`ZONA004.DOC`, `ZONA006.DOC`, `ZONA008.DOC`, `ZONA014.DOC`).
- Se extrajeron, limpiaron y normalizaron **1,811 registros de clientes**, asignando correctamente sus códigos, nombres comerciales, zonas (`004`, `006`, `008`, `014`) y teléfonos de contacto.

## 2. Archivo Generado en la Raíz
- **`clientes_procesados_zonas.csv`**: Ubicado directamente en la raíz del puente de trabajo de JJ PAPER.
- **Estructura Compatible con Supabase (`jjp_customers`)**:
  - `name`: Nombre comercial normalizado.
  - `phone`: Teléfono de contacto depurado.
  - `zone`: Zona asignada.
  - `rif`: RIF provisional único basado en el código del reporte.
  - `city`: Caracas.
  - `email`: Correo generado (`contacto[codigo]@jjpaper.local`).

## 3. Resumen de Buenas Prácticas
- **Automatización**: Uso de scripts reproducibles para transformar datos heredados (archivos DOS) a formatos estándar (CSV).
- **Integridad**: Relleno de campos obligatorios del esquema para prevenir errores de validación en la base de datos Supabase.
- **Disponibilidad**: Archivo listo para importación masiva por parte de los vendedores o el administrador.
