---
tags: [moc]
---

# 🧠 Cerebro JJ Paper — Mapa de contenido

Baúl de Obsidian = memoria viva del proyecto. Cada nota es un tema; los
`[[enlaces]]` forman el grafo. **Abre esta carpeta (`cerebro/`) como baúl en
Obsidian** (ver [[LEEME]]).

> ## ⚡ ¿Primera vez, o vuelves tras un tiempo? → **[[CONTEXTO]]**
> Es el embudo: una sola lectura y tienes el 80% del contexto. Todo lo demás
> es profundidad bajo esa nota.

## Cómo está organizado

```
CONTEXTO  ← el embudo, entrada única
   ├── Conceptos  ← entidades que cruzan TODOS los módulos (el centro del grafo)
   ├── Módulos    ← features de punta a punta
   ├── Sistema    ← infraestructura y mapas
   ├── Proyecto   ← memoria, metas y reglas
   ├── Seguridad  ← riesgos, incidentes y auditoría
   └── Índices    ← búsqueda inversa: por archivo, por tarea, por término
```

## 🔑 Conceptos — las entidades transversales

Empieza por aquí cuando vayas a **tocar algo**: cada nota cuenta el ciclo de vida
completo de una entidad y enlaza a todos los módulos donde vive.

- [[Cliente]] — nace por 5 puertas distintas; su historial lo es todo
- [[Producto y variante]] — lo que se vende es la variante, no el producto
- [[Pedido]] — donde el sistema toca dinero y stock de verdad
- [[Cotizacion]] — el paso previo a la venta al mayor
- [[Stock]] — zona prohibida sin permiso; el kardex manda
- [[Dinero y tasas]] — se piensa en dólares, se cobra en bolívares
- [[Cola de mensajes]] — el patrón que explica medio sistema
- [[Sesion y roles]] — quién puede hacer qué

## 🧩 Módulos — features de punta a punta

- [[Catalogo publico]] — catálogo, ficha, carrito, chatbot
- [[Ventas y cotizaciones]] — POS, cotizador, pedidos, comisiones
- [[Envio de documentos]] — doc-engine (PDF), hub 📤, ficha de producto
- [[CRM WhatsApp]] — chats, media, presencia, sesiones Baileys
- [[Correo]] — Gmail por usuario, bandeja bidireccional
- [[Inventario y conteo]] — kardex, conteo multi-persona, LAN offline
- [[Delivery]] — envío cotizado por distancia
- [[Difusion]] — campañas con throttle anti-baneo

## ⚙️ Sistema

- [[Arquitectura]] — vista de pájaro y decisiones estructurales
- [[Paginas y rutas]] — cada página con su script (y los parámetros de URL)
- [[Base de datos]] — tablas por dominio, RPCs reales, buckets, crons
- [[wa-server]] — el servidor de la tienda, módulo por módulo
- [[Configuracion]] — `jjp_settings`, `.env`, deploy, marca

## 📌 Proyecto

- [[Vision y metas]] — qué somos, hacia dónde vamos, qué NO somos
- [[Historia]] — cronología de todo lo construido
- [[Reglas de trabajo]] — cómo se trabaja aquí (obligatorio)
- [[Pendientes]] — lo que falta, con prioridad

## 🔐 Seguridad y calidad

- [[Modelo de seguridad]] — RLS, roles, qué ve el público, storage
- [[Incidentes]] — errores reales y cómo no repetirlos
- [[Guia maestra de auditoria]] — auditoría en 9 bloques con SQL
- [[Historial de auditorias]] — qué se auditó y cuándo

## 🔎 Índices

- [[Mapa de archivos]] — código ➜ nota (búsqueda inversa)
- [[Por tarea]] — "quiero hacer X" ➜ ruta y pasos
- [[Glosario]] — términos del negocio y del código
