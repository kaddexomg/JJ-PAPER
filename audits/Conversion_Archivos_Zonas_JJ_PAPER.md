---
tags:
  - auditoria
  - csv
  - migracion
  - zonas
---

# Conversión y Normalización de Archivos de Zonas (JJ PAPER)

## 1. Procesamiento de Archivos Fuente
- Se procesaron y convirtieron los reportes en formato `.DOC` (`ZONA004.DOC`, `ZONA006.DOC`, `ZONA008.DOC`, `ZONA014.DOC`) ubicados en la carpeta `CLIENTES/`.
- Se extrajeron más de 1,800 registros de clientes, extrayendo de forma precisa el código, nombre de empresa, zona y número telefónico.

## 2. Generación del CSV Limpio Compatible con Supabase
- Se generó el archivo `clientes_zonas_limpio_final.csv` estructurado con las columnas requeridas por el esquema `jjp_customers`:
  - `name`: Nombre de la empresa o cliente (normalizado).
  - `phone`: Teléfono extraído y filtrado sin ruido de columnas DOS.
  - `zone`: Código de zona (`004`, `006`, `008`, `014`).
  - `rif`: RIF provisional único generado a partir del código (ej. `J-003098`).
  - `city`: Ciudad por defecto (`Caracas / Venezuela`).
  - `email`: Correo estructurado único (`contacto[codigo]@jjpaper.local`).

## 3. Resumen Técnico de Buenas Practices
- **Parsers robustos**: Uso de expresiones regulares para aislar números de teléfono venezolanos y nombres comerciales en reportes legados de texto plano.
- **Preparación para CRM**: El archivo CSV resultante está completamente listo para ser importado directamente a través de la interfaz del panel de vendedor (`vcustomers.js`).
- **Trazabilidad**: Consolidación documental en la bóveda de Obsidian.
