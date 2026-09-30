# 🤝 Protocolo de Coordinación Multi-Agente (PC Empresa ↔ PC Remota)

> **Regla de Oro**: JJ Paper opera en producción real con clientes, facturación y WhatsApp activo. La coordinación entre el agente de la **PC de la Empresa** y el agente de la **PC Remota** debe ser estricta para evitar colisiones criptográficas, bloqueos de git y caídas de servicio.

---

## 1. ⚠️ Regla Crítica: UNA Sola Instancia de WhatsApp a la Vez

WhatsApp Web (Baileys) utiliza el protocolo criptográfico **Signal Protocol (Double Ratchet)**.
- **Riesgo Crítico**: Si se ejecutan dos procesos de `wa-server` simultáneamente conectados a la misma cuenta de WhatsApp (ej. en la laptop y en la tienda), ambos clientes WebSocket compiten por las llaves criptográficas de sesión. Esto genera **desincronización masiva ("Bad MAC Error")** y WhatsApp expulsa la sesión obligando a escanear QR nuevamente.
- **Asignación de Roles de Servidor**:
  - **PC Empresa (Tienda)**: Es el **servidor maestro de producción**. Tiene acceso físico a la unidad de red `M:\comp01\` (MixNet), maneja la exportación/importación DBF, y corre `wa-server` 24/7.
  - **PC Remota (Laptop/Casa)**: Trabaja en **desarrollo frontend, plantillas, optimizaciones de código, RLS, documentación y lógica de negocio**. Si necesita probar `wa-server`, debe ser para depuración puntual sin mantener sockets duplicados.

---

## 2. 🔄 Protocolo de Git y Sincronización

Para evitar conflictos de fusión (`merge conflicts`) y pérdida de trabajo:

1. **ANTES de escribir una sola línea de código**:
   ```bash
   git pull origin main
   ```
   Revisar qué cambió el otro agente leyendo `git log -n 5 --stat`.
2. **Commits pequeños, atómicos y descriptivos**:
   - `fix(wa): ...` para correcciones de WhatsApp.
   - `fix(campaigns): ...` para campañas.
   - `feat(mixer): ...` para MixNet.
   - `docs: ...` para documentación en `cerebro/` o `AGENTS.md`.
3. **INMEDIATAMENTE al terminar una tarea probada**:
   ```bash
   git add <archivos_especificos>
   git commit -m "tipo(scope): descripcion clara"
   git push origin main
   ```
   No dejar cambios sin pushear al finalizar un turno.

---

## 3. 🛡️ División de Responsabilidades por Agente

| Área | PC Empresa (Tienda) | PC Remota (Laptop) |
|---|---|---|
| **MixNet / DBF** | Lector/Escritor primario (`M:\comp01\`, `MXENCPED.DBF`, `MXCTAINV.DBF`). Pruebas de integración con Caja y facturación. | Lógica abstracta de parseo, normalización de esquemas y transformaciones JSON. |
| **WhatsApp Server** | Ejecución continua del servicio (`START-SERVIDOR.bat` / `run-service.bat`). | Diagnóstico de logs, refactorización defensiva, pruebas de endpoints y optimizaciones. |
| **Frontend / CRM** | Validación operativa en pantallas locales (POS, escáner WiFi LAN `8787/8788`). | Desarrollo de interfaces (`assets/js/admin/`, `assets/js/vendedor/`, campañas, cotizador). |
| **Documentación** | Registro de estado físico y rutas de red en `cerebro/`. | Mantenimiento de `AGENTS.md`, bitácoras de sesión y protocolos. |

---

## 4. ⚙️ Ciclo de Vida y Reinicio del Servidor (`wa-server`)

Cuando se modifica código en `wa-server/src/`:
1. **El código viejo permanece en RAM**: Node.js no recarga archivos automáticamente en producción.
2. **Reinicio requerido**:
   - Para aplicar cambios, se debe detener el proceso Node activo (`taskkill /F /IM node.exe` o `Stop-Process -Name node`).
   - El supervisor (`run-service.bat` / `START-SERVIDOR.bat`) relanzará automáticamente la nueva versión en 2 segundos.
   - Verificar en `logs/server.log` que los canales Realtime digan `SUBSCRIBED` y que el catálogo MixNet cargue limpiamente.

---

## 5. 🗄️ Arquitectura Multi-Proyecto Supabase

El sistema está dividido en 3 proyectos Supabase (Free Tier desacoplado):
- **Proyecto A (Core)** (`wwcdxqpibequfohbgejs`):
  - Clientes (`jjp_customers`), Catálogo y Precios (`jjp_products`, `jjp_product_variants`), Pedidos (`jjp_orders`), Cotizaciones (`jjp_quotes`), Ajustes/Tasas (`jjp_settings`).
- **Proyecto B (Comunicación)** (`klcibjwleiqppedefpxw`):
  - Sesiones WA (`jjp_wa_sessions`), Mensajes (`jjp_wa_messages`), Chats (`jjp_wa_chats`), Campañas (`jjp_wa_campaigns`, `jjp_wa_campaign_targets`), Correos (`jjp_emails`), Control de Servidor (`jjp_server_control`).
- **Proyecto C (Storage & Inventario)** (`nmcamjxhyysmmvgxgabo`):
  - Storage WebP (`jjp-products`), Comprobantes (`jjp-receipts`), Media de WhatsApp (`jjp-wa-media`).

**Regla**: Ningún agente debe mezclar credenciales de servicio entre proyectos ni alterar RLS sin documentar el motivo.

---

## 6. 📋 Checklist de Entrega de Turno (Handover)

Antes de que un agente termine su sesión para que el otro tome el relevo:
- [ ] `git status` limpio (todos los archivos commiteados y pusheados a `main`).
- [ ] `git push origin main` exitoso en GitHub.
- [ ] Nota breve en `cerebro/Sesiones/YYYY-MM-DD.md` explicando:
  1. Qué se corrigió o construyó.
  2. Estado actual del servidor (`wa-server` corriendo o detenido).
  3. Tarea inmediata recomendada para el siguiente agente.
