---
tags: [moc]
---

# 🧠 Cerebro JJ Paper — Mapa de contenido

Baúl de Obsidian = memoria viva del proyecto. Cada nota es un tema; los `[[enlaces]]`
forman el grafo. **Abre esta carpeta (`cerebro/`) como baúl en Obsidian** (ver [[LEEME]]).

> Para agentes de IA: empieza aquí, sigue por [[Reglas de trabajo]] y [[Vision y metas]].
> La versión corta para agentes vive en `AGENTS.md` (raíz del repo).

## El proyecto

- [[Vision y metas]] — qué es JJ Paper, hacia dónde vamos, qué NO somos
- [[Historia]] — cronología completa de lo construido (jul 2026 →)
- [[Reglas de trabajo]] — cómo se trabaja aquí (obligatorio)
- [[Pendientes]] — lo que falta, con prioridad y contexto

## El sistema

- [[Arquitectura]] — vista de pájaro: frontend + Supabase + wa-server
- [[Paginas y rutas]] — TODAS las páginas y qué script mueve cada una
- [[Base de datos]] — tablas por dominio, RPCs reales, buckets, vistas
- [[wa-server]] — el servidor de la tienda, módulo por módulo
- [[Configuracion]] — jjp_settings, .env, deploy, tareas de Windows

## Módulos (features de punta a punta)

- [[Catalogo publico]] — catálogo, ficha de producto, carrito, chatbot
- [[Ventas y cotizaciones]] — POS, cotizador, pedidos, conversión, comisiones
- [[Envio de documentos]] — doc-engine (PDF), send-hub (📤), ficha de producto
- [[CRM WhatsApp]] — chats, media, presencia, sesiones Baileys
- [[Correo]] — Gmail por usuario, bandeja bidireccional, adjuntos
- [[Inventario y conteo]] — variantes, kardex, conteo multi-persona, LAN offline
- [[Delivery]] — envío cotizado por distancia con mapa
- [[Difusion]] — campañas WhatsApp/correo con throttle anti-baneo

## Seguridad y calidad

- [[Modelo de seguridad]] — RLS, roles, qué ve el público, storage
- [[Incidentes]] — errores reales cometidos y cómo no repetirlos
- [[Guia maestra de auditoria]] — procedimiento completo de auditoría
- [[Historial de auditorias]] — qué se auditó, cuándo, qué se encontró
