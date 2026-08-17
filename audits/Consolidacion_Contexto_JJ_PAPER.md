---
tags:
  - auditoria
  - jj-paper
  - cerebro
---

# Auditoría del Cerebro y Contexto Real de JJ PAPER

## 1. Resumen de la Bóveda JJ PAPER
- **Ubicación**: `C:\Users\PC\Desktop\JJ PAPER`
- **Total de Notas**: 354 notas conectadas mediante un grafo estructurado en la carpeta `cerebro/`.
- **Nota Central (Embudo)**: `[[CONTEXTO]]` (`cerebro/CONTEXTO.md`), la cual resume el 80% del dominio del negocio y la arquitectura técnica.

## 2. Puntos Clave del Negocio y Arquitectura
- **Dominio**: Papelería real en Venezuela (venta al detal y al mayor). Sistema integral que incluye tienda online, POS, cotizador, CRM (WhatsApp y correo), inventario con conteo físico, delivery y comisiones.
- **Stack Tecnológico**:
  - **Frontend**: HTML/CSS/JS vainilla (sin frameworks), cargado por orden de scripts globales.
  - **Backend / Base de Datos**: Supabase (`oeiuczltgdexwjjgquyq`) mediante clave anon + RLS y RPCs personalizadas (`jjp_*`).
  - **Servidor Local (`wa-server`)**: Aplicación Node.js ejecutándose en la PC de la tienda para despacho asíncrono de WhatsApp y correo electrónico mediante cola de mensajes (`pending`).
- **Reglas de Oro del Proyecto**:
  - Producción activa (cualquier fallo impacta directamente en las ventas diarias).
  - Obligatorio confirmar planes antes de modificar código crítico.
  - Encolar notificaciones (nada se envía en directo).

## 3. Acciones Realizadas
- Exploración en profundidad del baúl Obsidian de `JJ PAPER`.
- Consolidación del contexto para la toma de decisiones técnicas del equipo.
- Registro en la memoria persistente del equipo y actualización del tablero Kanban.
