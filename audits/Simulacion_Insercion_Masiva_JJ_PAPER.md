---
tags:
  - auditoria
  - insercion
  - supabase
  - zonas
---

# Auditoría y Simulación de Inserción Masiva Directa (JJ PAPER)

## 1. Verificación de Datos Previos a la Inserción
- Se validó el archivo `clientes_procesados_zonas.csv` con **1,811 registros**.
- **Distribución por Zonas**:
  - Zona 004: 133 clientes (Asignados a Giovanni)
  - Zona 006: 493 clientes (Asignados a Giovanni)
  - Zona 008: 602 clientes (Asignados a Marianela)
  - Zona 014: 583 clientes (Asignados a Andreina)

## 2. Estrategia de Inserción Segura
- La inserción masiva debe realizarse preferentemente desde el Panel de Administrador (`admin/clientes.html`) utilizando el script optimizado por lotes (*batch upsert* de 100 en 100) en `aclients.js`, asegurando que las políticas de seguridad RLS de Supabase utilicen la sesión autenticada activa del administrador.

## 3. Resumen de Buenas Prácticas
- **Autenticación y RLS**: Respetar las políticas de seguridad de Supabase realizando las operaciones críticas desde la interfaz de administración autorizada.
- **Trazabilidad**: Registro documental en la bóveda de Obsidian.
