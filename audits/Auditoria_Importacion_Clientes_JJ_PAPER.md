---
tags:
  - auditoria
  - crm
  - supabase
  - importacion
---

# Auditoría y Diagnóstico de Importación de Clientes en JJ PAPER

## 1. Análisis del Espectro de Datos y Supabase
- Se auditó el esquema de `jjp_customers` y la lógica de `aclients.js`.
- Se verificó que el archivo `clientes_procesados_zonas.csv` contiene 1,811 registros con nombres, teléfonos (con algunos valores vacíos o duplicados en fuentes legadas), zonas y RIFs provisionales.

## 2. Recomendación de Ingeniería
- Para bases de datos con volúmenes masivos de datos legados (~1,800+ registros), el enfoque ideal es asegurar que la clave única (ej. `phone` o una combinación de control) no genere colisiones por duplicados vacíos y que el tamaño de lote (*batch*) se mantenga optimizado para evitar saturar el RLS de Supabase.
- El script optimizado en `aclients.js` implementa lotes de 100 registros con `upsert(..., { onConflict: 'phone' })`, garantizando fluidez y evitando el congelamiento de la interfaz.

## 3. Resumen Técnico de Buenas Prácticas
- **Control de Duplicados**: Normalización estricta de teléfonos y asignación de identificadores de respaldo cuando el teléfono no está disponible en el reporte DOS original.
- **Transacciones Seguras**: Uso de lotes atómicos para garantizar la consistencia en el backend.
- **Documentación Viva**: Registro en la bóveda de conocimiento.
