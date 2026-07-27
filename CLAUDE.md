# JJ PAPER — Instrucciones para Claude Code

Lee **`AGENTS.md`** (raíz): es la guía completa para agentes y aplica íntegra a Claude.
Detalle en `docs/ARQUITECTURA.md`, `docs/PELIGROS.md` y `docs/AUDITORIA.md`.

Reglas duras (resumen):

1. Confirma el plan (qué / por dónde / meta) ANTES de tocar código o DB.
2. Features reales de punta a punta, no cascarones.
3. No rompas `wa-server` (producción; sesión WhatsApp corrupta = re-escanear QR).
4. NUNCA toques datos de inventario sin orden explícita.
5. Di siempre qué no pudiste probar y cómo verificarlo.
6. Todo en español; `escapeHTML()` en todo HTML interpolado; sube el `?v=` de los
   scripts que edites.
7. Deploy = `git push` a `main` (Cloudflare Pages). Producción: `jj-paper.pages.dev`.
