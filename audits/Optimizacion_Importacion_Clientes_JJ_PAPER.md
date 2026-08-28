---
tags:
  - auditoria
  - optimizacion
  - supabase
  - importacion
---

# Optimización y Corrección de Importación Masiva en Admin (`aclients.js`)

## 1. Diagnóstico del Problema ("Colgado en Distribuyendo")
- **Causa Raíz**: El código anterior realizaba llamadas `await sb.from('jjp_customers').insert/update()` de forma secuencial fila por fila para los 1,811 registros. Esto provocaba una saturación de peticiones HTTP concurrentes hacia Supabase, agotando el bucle de eventos y generando timeouts o bloqueos en la interfaz ("colgado en Distribuyendo").

## 2. Solución Implementada
- **Procesamiento por Lotes (*Batch Upsert*)**:
  - Se estructuraron los 1,811 registros en bloques (*chunks*) de 100 elementos.
  - Se utilizó la función nativa `.upsert(chunk, { onConflict: 'phone' })` de Supabase para enviar lotes completos en una sola petición HTTP por bloque.
  - Se añadió fallback para teléfonos vacíos garantizando identificadores únicos temporales para evitar conflictos de nulidad.

## 3. Resumen Técnico de Buenas Prácticas
- **Optimización de Red**: Reducción drástica de 1,811 solicitudes HTTP a solo ~19 peticiones por lotes.
- **Resiliencia ante Timeouts**: Indicadores de progreso por lote para mantener informado al administrador durante la carga pesada.
- **Documentación**: Consolidación del aprendizaje en el cerebro Obsidian.
