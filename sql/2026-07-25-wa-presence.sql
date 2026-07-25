-- ============================================================
-- JJ Paper — presencia entrante del CRM WhatsApp (25-jul-2026)
--
-- El panel ya podía MANDAR "escribiendo…" al cliente, pero no RECIBIR el del
-- cliente. Para eso wa-server necesita dos permisos nuevos desde el panel:
--
--   watch    → observar la presencia de un chat (presenceSubscribe)
--   online   → el panel está a la vista: nos declaramos disponibles en WhatsApp
--              (es requisito de WhatsApp para que entregue la presencia ajena)
--   offline  → el panel se cerró: volvemos a invisible
--
-- 'online'/'offline' no pertenecen a ningún chat: van con chat_id nulo y
-- jid = 'self'. La presencia recibida NO se guarda en ninguna tabla — viaja por
-- Realtime Broadcast (canal 'wa-presence-<profile_id>'), así que no gasta cuota.
-- ============================================================

alter table public.jjp_wa_actions drop constraint if exists jjp_wa_actions_kind_check;

alter table public.jjp_wa_actions add constraint jjp_wa_actions_kind_check
  check (kind = any (array['react', 'read', 'typing', 'stop_typing', 'watch', 'online', 'offline']));
