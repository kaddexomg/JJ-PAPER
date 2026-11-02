/* ======================================================================
   JJ Paper — Liquid Glass Navigation System (iOS 26 High-End Glass)
   assets/js/admin/sidenav.js
   ----------------------------------------------------------------------
   • Auténtico efecto Liquid Glass: Translucidez cristalina, reflexión
     especular, saturación dinámica y desenfoque profundo.
   • Orbes de luz aurora flotante en el fondo ("luces en medio detrás").
   • Íconos SVG ultra-nítidos dibujados a mano con halos de luz independientes:
       - Ventas: Esmeralda Neón (#10b981)
       - Comunicación: Cyan Neón (#06b6d4)
       - Catálogo: Púrpura Glass (#8b5cf6)
       - Inventario: Ámbar Cálido (#f59e0b)
       - Sistema: Magenta / Rosa Neón (#ec4899)
       - Dashboard: Azul Eléctrico (#38bdf8)
   • Modo Colapsado Inteligente:
       - Al presionar un cuadro de categoría, NO se expande toda la barra.
       - Se despliega un cajón / tarjeta flotante Liquid Glass con las
         sub-opciones (ej. Prospectos, Crear Pedido) para navegar directo
         con 1 clic sin deformar el ancho de la pantalla.
   • Animación inclusiva del Logo JJ Paper con aura de luz respirable.
   • Botón dedicado y visible para Cerrar Sesión.
   • Persistencia en localStorage ('jjp_sidebar_collapsed').
   ====================================================================== */

(function () {
  const path = location.pathname;
  const isVendedor = /\/vendedor(\/|$)/i.test(path);
  const current = (path.split('/').pop() || 'index.html').toLowerCase() || 'index.html';

  // ÍCONOS SVG VECTORIALES DE ALTA PRECISIÓN (Razor-Sharp)
  const ICONS = {
    dashboard: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect></svg>`,
    ventas: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>`,
    pos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path></svg>`,
    cotizador: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>`,
    pedidos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`,
    cotizaciones: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>`,
    prospectos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`,
    documentos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg>`,
    comunicacion: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`,
    whatsapp: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>`,
    difusion: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path></svg>`,
    campanas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>`,
    correo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>`,
    catalogo: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`,
    productos: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path></svg>`,
    estudio: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"></path><circle cx="12" cy="13" r="3"></circle></svg>`,
    listas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>`,
    precios: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
    clientes: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    marcas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>`,
    unidades: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path></svg>`,
    inventario: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"></path><path d="M3 9h18"></path><path d="M9 21V9"></path></svg>`,
    conteo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"></line><line x1="4" y1="15" x2="20" y2="15"></line><line x1="10" y1="3" x2="8" y2="21"></line><line x1="16" y1="3" x2="14" y2="21"></line></svg>`,
    escaner: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path></svg>`,
    lan: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`,
    facturas: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"></path><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path></svg>`,
    sistema: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    agente: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8.01" y2="16"></line><line x1="16" y1="16" x2="16.01" y2="16"></line></svg>`,
    mixnet: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`,
    monitor: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>`,
    vendedores: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`,
    ajustes: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    publico: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`,
    impreso: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>`,
    logout: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`
  };

  /* ---- Configuración de Navegación ---- */
  const ADMIN_NAV = [
    { section: 'Principal' },
    { href: 'index.html', ico: ICONS.dashboard, label: 'Dashboard', color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)' },
    { 
      group: 'Ventas', 
      ico: ICONS.ventas, 
      color: '#10b981', 
      glow: 'rgba(16, 185, 129, 0.45)',
      items: [
        { href: 'pos.html',          ico: ICONS.pos, label: 'Crear Pedido' },
        { href: 'cotizador.html',    ico: ICONS.cotizador, label: 'Nueva Cotización' },
        { href: 'pedidos.html',      ico: ICONS.pedidos, label: 'Pedidos' },
        { href: 'cotizaciones.html', ico: ICONS.cotizaciones, label: 'Cotizaciones' },
        { href: 'prospectos.html',   ico: ICONS.prospectos, label: 'Prospectos B2B' },
        { href: 'documentos.html',   ico: ICONS.documentos, label: 'Documentos & Formas' },
      ]
    },
    { 
      group: 'Comunicación', 
      ico: ICONS.comunicacion, 
      color: '#06b6d4', 
      glow: 'rgba(6, 182, 212, 0.45)',
      items: [
        { href: 'whatsapp.html', ico: ICONS.whatsapp, label: 'WhatsApp' },
        { href: 'difusion.html', ico: ICONS.difusion, label: 'Difusión WA' },
        { href: 'campanas-email.html', ico: ICONS.campanas, label: 'Campañas Email' },
        { href: 'correo.html',   ico: ICONS.correo, label: 'Correo' },
      ]
    },
    { section: 'Catálogo' },
    { 
      group: 'Catálogo', 
      ico: ICONS.catalogo, 
      color: '#8b5cf6', 
      glow: 'rgba(139, 92, 246, 0.45)',
      items: [
        { href: 'productos.html', ico: ICONS.productos, label: 'Productos' },
        { href: 'estudio-fotos.html', ico: ICONS.estudio, label: 'Estudio IA de Fotos' },
        { href: 'listas-precios.html', ico: ICONS.listas, label: 'Listas & MixNet' },
        { href: 'precios.html',   ico: ICONS.precios, label: 'Precios' },
        { href: 'clientes.html',  ico: ICONS.clientes, label: 'Clientes CRM' },
        { href: 'marcas.html',    ico: ICONS.marcas, label: 'Marcas' },
        { href: 'unidades.html',  ico: ICONS.unidades, label: 'Unidades' },
        { href: 'catalogo.html',  ico: ICONS.catalogo, label: 'Catálogo' },
      ]
    },
    { 
      group: 'Inventario', 
      ico: ICONS.inventario, 
      color: '#f59e0b', 
      glow: 'rgba(245, 158, 11, 0.45)',
      items: [
        { href: 'inventario.html', ico: ICONS.inventario, label: 'Inventario' },
        { href: 'conteo.html',     ico: ICONS.conteo, label: 'Control de conteo' },
        { href: 'escaner.html',    ico: ICONS.escaner, label: 'Escáner' },
        { href: 'lan.html',        ico: ICONS.lan, label: 'Conteo WiFi (LAN)' },
        { href: 'facturas.html',   ico: ICONS.facturas, label: 'Cuentas por Pagar' },
      ]
    },
    { section: 'Sistema' },
    { 
      group: 'Sistema', 
      ico: ICONS.sistema, 
      color: '#ec4899', 
      glow: 'rgba(236, 72, 153, 0.45)',
      items: [
        { href: 'agente.html',     ico: ICONS.agente, label: 'Consola Agéntica (OpenCode)' },
        { href: 'mixnet.html',     ico: ICONS.mixnet, label: 'Puente MixNet ERP' },
        { href: 'monitor.html',    ico: ICONS.monitor, label: 'Monitor & Cuotas' },
        { href: 'vendedores.html', ico: ICONS.vendedores, label: 'Vendedores' },
        { href: 'ajustes.html',    ico: ICONS.ajustes, label: 'Ajustes' },
        { href: '/catalogo',       ico: ICONS.publico, label: 'Catálogo Cliente', ext: true },
        { href: '/catalogo_impreso', ico: ICONS.impreso, label: 'Catálogo con QR (Calle)', ext: true },
      ]
    }
  ];

  const VENDEDOR_NAV = [
    { section: 'Principal' },
    { href: 'index.html', ico: ICONS.dashboard, label: 'Mi Panel', color: '#38bdf8', glow: 'rgba(56, 189, 248, 0.45)' },
    { 
      group: 'Vender', 
      ico: ICONS.ventas, 
      color: '#10b981', 
      glow: 'rgba(16, 185, 129, 0.45)',
      items: [
        { href: 'pos.html',          ico: ICONS.pos, label: 'Crear Pedido' },
        { href: 'cotizador.html',    ico: ICONS.cotizador, label: 'Cotizador' },
        { href: 'cotizaciones.html', ico: ICONS.cotizaciones, label: 'Mis cotizaciones' },
        { href: 'documentos.html',   ico: ICONS.documentos, label: 'Documentos & Formas' },
        { href: 'consulta.html',     ico: ICONS.catalogo, label: 'Consultar stock' },
        { href: '../lista_costos.html', ico: ICONS.listas, label: 'Lista de precios', ext: true },
        { href: 'productos.html',    ico: ICONS.precios, label: 'Mis precios' },
        { href: 'catalogo.html',     ico: ICONS.catalogo, label: 'Catálogo' },
        { href: 'pedidos.html',      ico: ICONS.pedidos, label: 'Mis pedidos' },
      ]
    },
    { 
      group: 'Clientes', 
      ico: ICONS.clientes, 
      color: '#06b6d4', 
      glow: 'rgba(6, 182, 212, 0.45)',
      items: [
        { href: 'clientes.html', ico: ICONS.clientes, label: 'Mis clientes' },
        { href: 'difusion.html', ico: ICONS.difusion, label: 'Difusión WA' },
        { href: 'campanas-email.html', ico: ICONS.campanas, label: 'Campañas Email' },
      ]
    },
    { 
      group: 'Comunicación', 
      ico: ICONS.comunicacion, 
      color: '#8b5cf6', 
      glow: 'rgba(139, 92, 246, 0.45)',
      items: [
        { href: 'whatsapp.html', ico: ICONS.whatsapp, label: 'WhatsApp' },
        { href: 'correo.html',   ico: ICONS.correo, label: 'Correo' },
      ]
    },
    { section: 'Mi Cuenta' },
    { 
      group: 'Mi Cuenta', 
      ico: ICONS.ajustes, 
      color: '#ec4899', 
      glow: 'rgba(236, 72, 153, 0.45)',
      items: [
        { href: 'ajustes.html', ico: ICONS.ajustes, label: 'Mis ajustes' },
        { href: '/catalogo', ico: ICONS.publico, label: 'Catálogo Cliente', ext: true },
        { href: '/catalogo_impreso', ico: ICONS.impreso, label: 'Catálogo con QR (Calle)', ext: true },
      ]
    }
  ];

  let NAV = isVendedor ? VENDEDOR_NAV : ADMIN_NAV;
  let DIR = isVendedor ? 'vendedor' : 'admin';

  function absHref(href) {
    if (!href || href === '#' || /^https?:/i.test(href)) return href;
    if (href.startsWith('/')) return href;
    if (href.startsWith('../')) return '/' + href.replace(/^\.\.\//, '');
    return '/' + DIR + '/' + href.replace(/^\/+/, '');
  }

  function isActive(href) {
    if (!href) return false;
    const target = href.split('/').pop().toLowerCase();
    if (href.includes('/')) {
      const cleanHref = href.replace(/^\.\.\//, '');
      return path.toLowerCase().endsWith(cleanHref.toLowerCase()) || target === current;
    }
    return target === current;
  }

  function linkEl(it) {
    const a = document.createElement('a');
    a.href = it.href ? absHref(it.href) : '#';
    if (it.ext) a.target = '_blank';
    if (it.action === 'logout') {
      a.href = '#';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.adminLogout) window.adminLogout();
        else if (typeof adminLogout === 'function') adminLogout();
      });
    }
    if (isActive(it.href)) a.className = 'on';
    if (it.color) a.style.setProperty('--cat-color', it.color);
    if (it.glow) a.style.setProperty('--cat-glow', it.glow);
    a.innerHTML = `<span class="a-ico">${it.ico || ''}</span> <span class="a-txt">${it.label}</span>`;
    return a;
  }

  function sectionEl(txt) {
    const s = document.createElement('span');
    s.className = 'a-section';
    s.textContent = txt;
    return s;
  }

  // Tarjeta / Popout Flotante en Modo Colapsado
  let activeFlyoutCard = null;

  function closeFlyout() {
    if (activeFlyoutCard) {
      activeFlyoutCard.remove();
      activeFlyoutCard = null;
    }
  }

  function openFlyout(groupNode, anchorBtn) {
    closeFlyout();

    const rect = anchorBtn.getBoundingClientRect();
    const card = document.createElement('div');
    card.className = 'jjp-liquid-flyout-card';
    card.style.setProperty('--cat-color', groupNode.color || '#10b981');
    card.style.setProperty('--cat-glow', groupNode.glow || 'rgba(16, 185, 129, 0.45)');

    // Calcular posición vertical para que no se salga de pantalla
    const topPos = Math.max(16, Math.min(window.innerHeight - 360, rect.top - 10));
    card.style.top = `${topPos}px`;
    card.style.left = `82px`;

    let itemsHtml = groupNode.items.map(it => {
      const activeCls = isActive(it.href) ? 'on' : '';
      return `<a href="${absHref(it.href)}" class="flyout-item ${activeCls}" ${it.ext ? 'target="_blank"' : ''}>
        <span class="a-ico">${it.ico}</span>
        <span class="a-txt">${it.label}</span>
      </a>`;
    }).join('');

    card.innerHTML = `
      <div class="flyout-hd">
        <span class="flyout-hd-ico">${groupNode.ico}</span>
        <span class="flyout-hd-title">${groupNode.group}</span>
      </div>
      <div class="flyout-body">
        ${itemsHtml}
      </div>
    `;

    document.body.appendChild(card);
    activeFlyoutCard = card;

    // Cerrar al hacer clic fuera
    setTimeout(() => {
      const onDocClick = (e) => {
        if (!card.contains(e.target) && !anchorBtn.contains(e.target)) {
          closeFlyout();
          document.removeEventListener('click', onDocClick);
        }
      };
      document.addEventListener('click', onDocClick);
    }, 10);
  }

  function groupEl(g) {
    const wrap = document.createElement('div');
    wrap.className = 'nav-group';
    if (g.color) wrap.style.setProperty('--cat-color', g.color);
    if (g.glow) wrap.style.setProperty('--cat-glow', g.glow);

    const hasActive = g.items.some((it) => isActive(it.href));
    if (hasActive) wrap.classList.add('open', 'has-active');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-group-btn';
    btn.setAttribute('aria-expanded', hasActive ? 'true' : 'false');
    btn.title = g.group;
    btn.innerHTML =
      `<span class="a-ico">${g.ico || ''}</span>` +
      `<span class="a-txt">${g.group}</span>` +
      `<span class="nav-caret" aria-hidden="true">▾</span>`;

    const sub = document.createElement('div');
    sub.className = 'nav-sub';
    g.items.forEach((it) => sub.appendChild(linkEl(it)));

    btn.addEventListener('click', (e) => {
      const aside = document.querySelector('.admin-aside') || document.querySelector('aside.aside');
      if (aside && aside.classList.contains('collapsed')) {
        // EN MODO COLAPSADO: NUNCA expandir toda la barra.
        // Abre directamente el popout flotante con las opciones
        e.stopPropagation();
        if (activeFlyoutCard && activeFlyoutCard.dataset.group === g.group) {
          closeFlyout();
        } else {
          openFlyout(g, btn);
          if (activeFlyoutCard) activeFlyoutCard.dataset.group = g.group;
        }
        return;
      }
      const open = wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    wrap.appendChild(btn);
    wrap.appendChild(sub);
    return wrap;
  }

  function toggleCollapse(forceState) {
    closeFlyout();
    const aside = document.querySelector('.admin-aside') || document.querySelector('aside.aside');
    if (!aside) return;

    const shouldCollapse = (typeof forceState === 'boolean')
      ? forceState
      : !aside.classList.contains('collapsed');

    if (shouldCollapse) {
      aside.classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
      localStorage.setItem('jjp_sidebar_collapsed', '1');
    } else {
      aside.classList.remove('collapsed');
      document.body.classList.remove('sidebar-collapsed');
      localStorage.setItem('jjp_sidebar_collapsed', '0');
    }

    const tBtn = document.getElementById('jjpAsideToggleBtn');
    if (tBtn) {
      tBtn.innerHTML = shouldCollapse ? '▶' : '◀';
      tBtn.title = shouldCollapse ? 'Expandir barra lateral' : 'Colapsar barra lateral';
    }
  }
  window.__jjpToggleSidebar = toggleCollapse;

  function renderNav() {
    const host = document.querySelector('.aside-nav');
    if (!host) return;
    host.innerHTML = '';
    NAV.forEach((node) => {
      if (node.section) return host.appendChild(sectionEl(node.section));
      if (node.group)   return host.appendChild(groupEl(node));
      host.appendChild(linkEl(node));
    });

    // Inyectar botón de colapso y animación al logo en .aside-brand
    const asideBrand = document.querySelector('.aside-brand');
    if (asideBrand && !document.getElementById('jjpAsideToggleBtn')) {
      const logoImg = asideBrand.querySelector('.n-logo-img');
      if (logoImg) logoImg.classList.add('jjp-logo-animated');

      const leftWrap = document.createElement('div');
      leftWrap.className = 'aside-brand-left';
      while (asideBrand.firstChild) {
        leftWrap.appendChild(asideBrand.firstChild);
      }
      asideBrand.appendChild(leftWrap);

      const tBtn = document.createElement('button');
      tBtn.type = 'button';
      tBtn.id = 'jjpAsideToggleBtn';
      tBtn.className = 'jjp-aside-toggle';
      tBtn.setAttribute('aria-label', 'Colapsar menú');
      tBtn.title = 'Colapsar / Expandir barra';
      tBtn.innerHTML = '◀';
      tBtn.addEventListener('click', () => toggleCollapse());
      asideBrand.appendChild(tBtn);
    }

    // Inyectar botón de Cerrar Sesión en .aside-ft
    const asideFt = document.querySelector('.aside-ft');
    if (asideFt && !document.getElementById('jjpAsideLogoutBtn')) {
      const logoutBtn = document.createElement('button');
      logoutBtn.type = 'button';
      logoutBtn.id = 'jjpAsideLogoutBtn';
      logoutBtn.className = 'jjp-aside-logout-btn';
      logoutBtn.title = 'Cerrar Sesión Segura';
      logoutBtn.innerHTML = `<span class="jjp-logout-ico">${ICONS.logout}</span><span class="jjp-logout-txt">Cerrar Sesión</span>`;
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.adminLogout) window.adminLogout();
        else if (typeof adminLogout === 'function') adminLogout();
      });
      asideFt.appendChild(logoutBtn);
    }

    // Inyectar orbes de luz aurora de fondo
    injectBackgroundAurora();

    // Aplicar estado colapsado inicial si estaba guardado
    const savedCollapsed = localStorage.getItem('jjp_sidebar_collapsed') === '1';
    if (savedCollapsed && window.innerWidth > 900) {
      toggleCollapse(true);
    }
  }

  function injectBackgroundAurora() {
    if (document.getElementById('jjpGlassAurora')) return;
    const aurora = document.createElement('div');
    aurora.id = 'jjpGlassAurora';
    aurora.className = 'jjp-glass-aurora';
    aurora.setAttribute('aria-hidden', 'true');
    aurora.innerHTML = `
      <div class="jjp-aurora-orb jjp-orb-emerald"></div>
      <div class="jjp-aurora-orb jjp-orb-cyan"></div>
      <div class="jjp-aurora-orb jjp-orb-violet"></div>
    `;
    document.body.prepend(aurora);
  }

  /* ---- CSS AUTO-INYECTADO: AUTÉNTICO LIQUID GLASS (iOS 26 SPEC) ---- */
  function injectCSS() {
    if (document.getElementById('jjp-sidenav-css')) return;
    const css = `
    /* ==============================================================
       AUTÉNTICO LIQUID GLASS iOS 26 CON ORBES AURORA DECORATIVOS
       ============================================================== */
    .jjp-glass-aurora {
      position: fixed; inset: 0; pointer-events: none; z-index: 1;
      overflow: hidden; opacity: 0.55;
    }
    .jjp-aurora-orb {
      position: absolute; border-radius: 50%;
      filter: blur(100px); mix-blend-mode: screen;
    }
    .jjp-orb-emerald {
      width: 440px; height: 440px;
      background: radial-gradient(circle, rgba(16, 185, 129, 0.5) 0%, rgba(16, 185, 129, 0) 70%);
      top: -60px; left: -40px;
      animation: jjpFloatAura1 14s ease-in-out infinite alternate;
    }
    .jjp-orb-cyan {
      width: 480px; height: 480px;
      background: radial-gradient(circle, rgba(6, 182, 212, 0.45) 0%, rgba(6, 182, 212, 0) 70%);
      top: 35vh; left: -80px;
      animation: jjpFloatAura2 18s ease-in-out infinite alternate;
    }
    .jjp-orb-violet {
      width: 400px; height: 400px;
      background: radial-gradient(circle, rgba(139, 92, 246, 0.45) 0%, rgba(139, 92, 246, 0) 70%);
      bottom: -40px; left: 10px;
      animation: jjpFloatAura3 16s ease-in-out infinite alternate;
    }
    @keyframes jjpFloatAura1 {
      0% { transform: translate(0, 0) scale(1); }
      100% { transform: translate(40px, 60px) scale(1.15); }
    }
    @keyframes jjpFloatAura2 {
      0% { transform: translate(0, 0) scale(1); }
      100% { transform: translate(-30px, -50px) scale(1.1); }
    }
    @keyframes jjpFloatAura3 {
      0% { transform: translate(0, 0) scale(1); }
      100% { transform: translate(50px, -40px) scale(1.2); }
    }

    /* BARRA LATERAL LIQUID GLASS */
    .admin-aside, aside.aside {
      background: rgba(10, 17, 30, 0.48) !important;
      backdrop-filter: blur(32px) saturate(220%) !important;
      -webkit-backdrop-filter: blur(32px) saturate(220%) !important;
      border-right: 1px solid rgba(255, 255, 255, 0.14) !important;
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.08), 10px 0 35px rgba(0, 0, 0, 0.4) !important;
      transition: width 0.32s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s ease !important;
      z-index: 200 !important;
    }

    .admin-main, main.admin-main {
      transition: margin-left 0.32s cubic-bezier(0.16, 1, 0.3, 1) !important;
      position: relative; z-index: 2;
    }
    body.sidebar-collapsed .admin-main,
    body.sidebar-collapsed main.admin-main {
      margin-left: 74px !important;
    }

    /* CABECERA */
    .aside-brand {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 16px 16px 14px !important;
      position: relative !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
    }
    .aside-brand-left {
      display: flex; align-items: center; gap: 10px; overflow: hidden; white-space: nowrap;
    }
    .jjp-aside-toggle {
      width: 28px; height: 28px; border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all 0.2s ease;
      flex-shrink: 0; font-size: 11px; font-weight: 700;
      backdrop-filter: blur(12px);
      box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.2);
    }
    .jjp-aside-toggle:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.08);
    }

    /* LOGO CON AURA VIVA */
    .jjp-logo-animated {
      width: 38px; height: 38px; border-radius: 50%;
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.55));
      animation: jjpLogoPulse 4s ease-in-out infinite;
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    .jjp-logo-animated:hover {
      transform: rotate(8deg) scale(1.12);
    }
    @keyframes jjpLogoPulse {
      0%   { filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.5)); }
      50%  { filter: drop-shadow(0 0 16px rgba(6, 182, 212, 0.85)); transform: scale(1.04) rotate(2deg); }
      100% { filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.5)); }
    }
    @media (prefers-reduced-motion: reduce) {
      .jjp-logo-animated { animation: none !important; }
      .jjp-aurora-orb { animation: none !important; }
    }

    /* BOTONES DE GRUPO Y NAVEGACIÓN EN MODO EXPANDIDO */
    .aside-nav .nav-group { display:flex; flex-direction:column; position:relative }
    .aside-nav .nav-group-btn {
      display:flex; align-items:center; gap:12px; width:100%;
      padding:11px 16px; font-size:13.5px; font-weight:600;
      color:rgba(255,255,255,.85); background:none; border:0; cursor:pointer;
      font-family:inherit; text-align:left; transition:all .2s ease;
      border-radius: 10px; margin: 2px 10px; width: calc(100% - 20px);
    }
    .aside-nav .nav-group-btn:hover {
      background:rgba(255,255,255,.10); color:#fff;
      box-shadow: 0 0 16px var(--cat-glow, transparent), inset 0 1px 1px rgba(255,255,255,0.2);
    }
    .aside-nav .nav-group-btn .a-ico {
      width:22px; display:flex; align-items:center; justify-content:center; flex-shrink:0;
      color: var(--cat-color, #10b981);
      filter: drop-shadow(0 0 6px var(--cat-color, transparent));
    }
    .aside-nav .nav-group-btn .a-txt { flex:1 }
    .aside-nav .nav-caret {
      font-size:11px; opacity:.7; transition:transform .28s ease; flex-shrink:0;
    }
    .aside-nav .nav-group.open .nav-caret { transform:rotate(180deg) }
    .aside-nav .nav-group.has-active > .nav-group-btn { color:#fff; font-weight:700 }

    /* SUBMENÚ ACORDEÓN EXPANDIBLE FLUIDO */
    .aside-nav .nav-sub {
      display:grid; grid-template-rows:0fr;
      transition:grid-template-rows .28s cubic-bezier(0.16, 1, 0.3, 1);
      background:rgba(0,0,0,.22);
      border-radius: 10px; margin: 0 10px 4px 10px;
    }
    .aside-nav .nav-group.open .nav-sub { grid-template-rows:1fr }
    .aside-nav .nav-sub > * { min-height:0; overflow:hidden }
    .aside-nav .nav-sub a {
      padding: 9px 12px 9px 36px; font-size:12.5px;
      color:rgba(255,255,255,.75);
      transition: all 0.18s ease;
      text-decoration:none; display:flex; align-items:center; gap:10px;
    }
    .aside-nav .nav-sub a:hover { color:#fff; background:rgba(255,255,255,.12); padding-left:40px }
    .aside-nav .nav-sub a.on {
      background:var(--cat-glow, rgba(16, 185, 129, 0.25)); color:#fff;
      border-left:3px solid var(--cat-color, #10b981);
      font-weight:700;
    }

    /* ENLACES INDIVIDUALES EXPANDIDOS */
    .aside-nav a {
      display:flex; align-items:center; gap:12px; padding:11px 16px;
      font-size:13.5px; font-weight:600; color:rgba(255,255,255,.85);
      transition:all .2s ease; cursor:pointer; text-decoration:none;
      border-radius: 10px; margin: 2px 10px; width: calc(100% - 20px);
    }
    .aside-nav a:hover { background:rgba(255,255,255,.10); color:#fff }
    .aside-nav a.on {
      background:rgba(255,255,255,.16); color:#fff;
      border-left:3px solid var(--cat-color, #10b981);
      font-weight:700;
    }
    .aside-nav a .a-ico {
      width:22px; display:flex; align-items:center; justify-content:center; flex-shrink:0;
      color: var(--cat-color, #fff);
      filter: drop-shadow(0 0 6px var(--cat-color, transparent));
    }

    /* ==============================================================
       ESTADO COLAPSADO: CUADROS LIQUID GLASS CON HALO REAL
       ============================================================== */
    .admin-aside.collapsed, aside.aside.collapsed {
      width: 74px !important;
    }
    .admin-aside.collapsed .aside-brand span,
    .admin-aside.collapsed .aside-brand em,
    .admin-aside.collapsed .jjp-cmd-pill,
    .admin-aside.collapsed .a-section,
    .admin-aside.collapsed .aside-ft > div:first-child,
    .admin-aside.collapsed .nav-group-btn .a-txt,
    .admin-aside.collapsed .nav-group-btn .nav-caret,
    .admin-aside.collapsed .aside-nav > a .a-txt,
    .admin-aside.collapsed .nav-sub {
      display: none !important;
    }

    .admin-aside.collapsed .aside-brand {
      justify-content: center !important;
      padding: 14px 6px !important;
    }
    .admin-aside.collapsed .aside-brand-left {
      margin-bottom: 8px;
    }
    .admin-aside.collapsed .jjp-aside-toggle {
      position: absolute; bottom: -12px; right: 23px; z-index: 10;
    }

    .admin-aside.collapsed .nav-group,
    .admin-aside.collapsed .aside-nav > a {
      margin: 8px auto !important;
      width: 50px !important;
      display: flex !important;
      justify-content: center !important;
      position: relative !important;
    }

    .admin-aside.collapsed .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a {
      width: 50px !important;
      height: 50px !important;
      padding: 0 !important;
      margin: 0 !important;
      border-radius: 14px !important;
      background: rgba(255, 255, 255, 0.06) !important;
      backdrop-filter: blur(18px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(18px) saturate(200%) !important;
      border: 1px solid rgba(255, 255, 255, 0.16) !important;
      box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.28), 0 4px 16px var(--cat-glow, rgba(0,0,0,0.25)) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
      cursor: pointer !important;
    }

    .admin-aside.collapsed .nav-group-btn .a-ico,
    .admin-aside.collapsed .aside-nav > a .a-ico {
      width: auto !important;
      color: var(--cat-color, #10b981) !important;
      filter: drop-shadow(0 0 8px var(--cat-color, #10b981)) !important;
      transition: transform 0.2s ease !important;
    }

    .admin-aside.collapsed .nav-group:hover .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a:hover {
      transform: scale(1.10) translateY(-2px) !important;
      background: rgba(255, 255, 255, 0.16) !important;
      border-color: var(--cat-color, rgba(255, 255, 255, 0.45)) !important;
      box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.4), 0 0 26px var(--cat-glow, rgba(16, 185, 129, 0.5)) !important;
    }

    .admin-aside.collapsed .nav-group.has-active .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a.on {
      border-color: var(--cat-color, #10b981) !important;
      background: var(--cat-glow, rgba(16, 185, 129, 0.28)) !important;
      box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.35), 0 0 22px var(--cat-glow, rgba(16, 185, 129, 0.6)) !important;
    }

    /* ==============================================================
       TARJETA FLOTANTE LIQUID GLASS (FLYOUT EN MODO COLAPSADO)
       ============================================================== */
    .jjp-liquid-flyout-card {
      position: fixed;
      width: 250px;
      background: rgba(12, 20, 36, 0.88) !important;
      backdrop-filter: blur(36px) saturate(220%) !important;
      -webkit-backdrop-filter: blur(36px) saturate(220%) !important;
      border: 1.5px solid var(--cat-color, rgba(255, 255, 255, 0.25)) !important;
      border-radius: 18px !important;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 35px var(--cat-glow, transparent), inset 0 1px 2px rgba(255, 255, 255, 0.3) !important;
      padding: 10px !important;
      z-index: 999999 !important;
      animation: jjpFlyoutScale 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes jjpFlyoutScale {
      0%   { opacity: 0; transform: translateX(-12px) scale(0.92); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }

    .flyout-hd {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 6px;
    }
    .flyout-hd-ico {
      color: var(--cat-color, #10b981);
      filter: drop-shadow(0 0 8px var(--cat-color, #10b981));
    }
    .flyout-hd-title {
      font-size: 14px; font-weight: 800; color: #fff; letter-spacing: 0.3px;
    }

    .flyout-body {
      display: flex; flex-direction: column; gap: 3px; max-height: 400px; overflow-y: auto;
    }

    .flyout-item {
      display: flex !important; align-items: center !important; gap: 10px !important;
      padding: 9px 12px !important;
      border-radius: 10px !important;
      font-size: 13px !important; font-weight: 600 !important;
      color: rgba(255, 255, 255, 0.82) !important;
      text-decoration: none !important;
      transition: all 0.16s ease !important;
    }
    .flyout-item:hover {
      background: rgba(255, 255, 255, 0.14) !important;
      color: #fff !important;
      transform: translateX(4px) !important;
    }
    .flyout-item.on {
      background: var(--cat-glow, rgba(16, 185, 129, 0.25)) !important;
      border-left: 3px solid var(--cat-color, #10b981) !important;
      color: #fff !important;
      font-weight: 700 !important;
    }
    .flyout-item .a-ico {
      color: var(--cat-color, #fff);
      filter: drop-shadow(0 0 4px var(--cat-color, transparent));
    }

    /* BOTÓN CERRAR SESIÓN */
    .jjp-aside-logout-btn {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 10px !important;
      width: 100% !important;
      margin-top: 10px !important;
      padding: 11px 14px !important;
      background: rgba(239, 68, 68, 0.14) !important;
      border: 1px solid rgba(239, 68, 68, 0.32) !important;
      border-radius: 12px !important;
      color: #fca5a5 !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      font-family: inherit !important;
      backdrop-filter: blur(14px) !important;
      box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
    }
    .jjp-aside-logout-btn:hover {
      background: rgba(239, 68, 68, 0.28) !important;
      border-color: #ef4444 !important;
      color: #ffffff !important;
      transform: translateY(-2px) !important;
      box-shadow: 0 4px 18px rgba(239, 68, 68, 0.45) !important;
    }
    .admin-aside.collapsed .jjp-aside-logout-btn {
      width: 50px !important;
      height: 50px !important;
      padding: 0 !important;
      margin: 10px auto !important;
      border-radius: 14px !important;
    }
    .admin-aside.collapsed .jjp-aside-logout-btn .jjp-logout-txt {
      display: none !important;
    }

    @media (max-width: 900px) {
      .admin-aside.collapsed { width: 240px !important; }
      body.sidebar-collapsed .admin-main { margin-left: 0 !important; }
      .jjp-aside-toggle { display: none !important; }
    }
    `;
    const style = document.createElement('style');
    style.id = 'jjp-sidenav-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function applyRole() {
    if (typeof loadProfile !== 'function') return;
    let role;
    try { role = (await loadProfile())?.role; } catch (e) { return; }
    if (!role) return;
    NAV = role === 'admin' ? ADMIN_NAV : VENDEDOR_NAV;
    DIR = role === 'admin' ? 'admin' : 'vendedor';
    renderNav();
  }

  function init() {
    injectCSS();
    renderNav();
    applyRole();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
