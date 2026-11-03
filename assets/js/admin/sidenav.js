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
    a.addEventListener('mouseenter', () => {
      if (window.__jjpLightReaction && (it.color || '#38bdf8')) {
        window.__jjpLightReaction(it.color || '#38bdf8', a);
      }
    });
    a.addEventListener('click', () => {
      if (window.__jjpLightReaction && (it.color || '#38bdf8')) {
        window.__jjpLightReaction(it.color || '#38bdf8', a);
      }
    });
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

    btn.addEventListener('mouseenter', () => {
      if (window.__jjpLightReaction && g.color) {
        window.__jjpLightReaction(g.color, btn);
      }
    });
    btn.addEventListener('click', (e) => {
      if (window.__jjpLightReaction && g.color) {
        window.__jjpLightReaction(g.color, btn);
      }
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
      tBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="jjp-toggle-svg"><polyline points="15 18 9 12 15 6"></polyline></svg>';
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

  /* ======================================================================
     MOTOR DE ILUMINACIÓN FLUIDA AURORA LIQUID GLASS (GPU HARDWARE COMPOSITING)
     ----------------------------------------------------------------------
     - Corrientes laminares armónicas continuas (Lissajous multioctava)
     - Cero tirones de FPS ("cero caseo"), 120 FPS fluidos por aceleración GPU
     - Flujo orgánico continuo, sin choques rígidos ni rebotes artificiales
     - Reacción cromática viva al interactuar con categorías y ratón
     ====================================================================== */

  function injectBackgroundAurora() {
    const existingCanvas = document.getElementById('jjpAuroraCanvas');
    if (existingCanvas) existingCanvas.remove();
    if (document.getElementById('jjpAuroraFlow')) return;

    const flowContainer = document.createElement('div');
    flowContainer.id = 'jjpAuroraFlow';
    flowContainer.className = 'jjp-aurora-flow';
    flowContainer.setAttribute('aria-hidden', 'true');
    document.body.prepend(flowContainer);

    initLiquidAuroraFlowEngine(flowContainer);
  }

  function initLiquidAuroraFlowEngine(container) {
    let width = window.innerWidth;
    let height = window.innerHeight;

    function onResize() {
      width = window.innerWidth;
      height = window.innerHeight;
    }
    window.addEventListener('resize', onResize);

    // 5 Corrientes armónicas de luz líquida orgánica
    const STREAMS_SPEC = [
      {
        id: 0, // Lateral / Sidebar Reactor (Luz que retroilumina la barra de navegación)
        baseX: 0.10, baseY: 0.38,
        radius: 360,
        fx1: 0.00030, fx2: 0.00045, fy1: 0.00038, fy2: 0.00058,
        px1: 0.0, px2: 1.5, py1: 0.8, py2: 2.3,
        ampX1: 90, ampX2: 50, ampY1: 160, ampY2: 70,
        fs: 0.00048, ps: 0.0,
        bg: 'radial-gradient(circle at 40% 40%, rgba(16, 185, 129, 0.78) 0%, rgba(6, 182, 212, 0.45) 45%, transparent 75%)'
      },
      {
        id: 1, // Corriente Superior Eléctrica (Cyan / Zafiro)
        baseX: 0.48, baseY: 0.20,
        radius: 340,
        fx1: 0.00036, fx2: 0.00052, fy1: 0.00029, fy2: 0.00046,
        px1: 1.2, px2: 2.8, py1: 0.4, py2: 1.9,
        ampX1: 130, ampX2: 65, ampY1: 90, ampY2: 45,
        fs: 0.00058, ps: 1.4,
        bg: 'radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.72) 0%, rgba(56, 189, 248, 0.42) 45%, transparent 75%)'
      },
      {
        id: 2, // Vórtice Cósmico Central (Violeta / Fucsia Profundo)
        baseX: 0.72, baseY: 0.40,
        radius: 380,
        fx1: 0.00028, fx2: 0.00042, fy1: 0.00042, fy2: 0.00064,
        px1: 2.5, px2: 0.3, py1: 1.7, py2: 3.1,
        ampX1: 120, ampX2: 60, ampY1: 135, ampY2: 65,
        fs: 0.00042, ps: 2.8,
        bg: 'radial-gradient(circle at 45% 45%, rgba(139, 92, 246, 0.70) 0%, rgba(236, 72, 153, 0.38) 45%, transparent 75%)'
      },
      {
        id: 3, // Corriente Cálida Inferior (Ámbar Dorado / Mandarina)
        baseX: 0.28, baseY: 0.76,
        radius: 320,
        fx1: 0.00040, fx2: 0.00058, fy1: 0.00032, fy2: 0.00050,
        px1: 3.1, px2: 1.9, py1: 2.4, py2: 0.7,
        ampX1: 105, ampX2: 50, ampY1: 110, ampY2: 55,
        fs: 0.00052, ps: 4.1,
        bg: 'radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.70) 0%, rgba(249, 115, 22, 0.35) 45%, transparent 75%)'
      },
      {
        id: 4, // Resplandor de Horizonte (Rosa Aurora / Cielo Glacial)
        baseX: 0.82, baseY: 0.76,
        radius: 350,
        fx1: 0.00034, fx2: 0.00048, fy1: 0.00037, fy2: 0.00055,
        px1: 0.7, px2: 3.4, py1: 3.2, py2: 1.2,
        ampX1: 115, ampX2: 55, ampY1: 100, ampY2: 50,
        fs: 0.00048, ps: 5.2,
        bg: 'radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.65) 0%, rgba(56, 189, 248, 0.35) 45%, transparent 75%)'
      }
    ];

    const streams = STREAMS_SPEC.map(spec => {
      const el = document.createElement('div');
      el.className = `jjp-flow-stream jjp-stream-${spec.id}`;
      el.style.width = `${spec.radius * 2}px`;
      el.style.height = `${spec.radius * 2}px`;
      el.style.background = spec.bg;
      container.appendChild(el);

      return {
        ...spec,
        el,
        curX: spec.baseX * width,
        curY: spec.baseY * height,
        curScale: 1.0,
        offsetX: 0,
        offsetY: 0,
        boostScale: 1.0
      };
    });

    // Ratón con amortiguación suave de fluidos
    const mouse = { x: -1000, y: -1000 };
    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    }, { passive: true });

    // REACCIÓN GLOBAL AL POSARSE O HACER CLIC EN CATEGORÍAS
    window.__jjpLightReaction = function (colorHex, sourceEl) {
      if (!colorHex) return;

      let targetY = height * 0.38;
      if (sourceEl && typeof sourceEl.getBoundingClientRect === 'function') {
        const r = sourceEl.getBoundingClientRect();
        targetY = r.top + (r.height / 2);
      }

      // El Stream 0 (retroiluminación de la barra) responde inmediatamente
      const s0 = streams[0];
      if (s0) {
        s0.el.style.background = `radial-gradient(circle at 40% 40%, ${colorHex} 0%, rgba(255,255,255,0.2) 25%, ${colorHex}44 50%, transparent 75%)`;
        s0.boostScale = 1.38;
        s0.offsetY = (targetY - (s0.baseY * height)) * 0.80;
      }

      // Onda armónica secundaria hacia los demás flujos (sin tirones)
      for (let i = 1; i < streams.length; i++) {
        const st = streams[i];
        st.boostScale = 1.15;
        st.offsetX += (Math.random() - 0.5) * 35;
        st.offsetY += (targetY - st.curY) * 0.10;
      }
    };

    let animId = null;

    function render(time) {
      if (document.hidden) {
        animId = requestAnimationFrame(render);
        return;
      }

      for (let i = 0; i < streams.length; i++) {
        const s = streams[i];

        // 1. Ecuación de flujo laminar armónico continuo (Lissajous multioctava)
        const naturalX = (s.baseX * width) + Math.sin(time * s.fx1 + s.px1) * s.ampX1 + Math.cos(time * s.fx2 + s.px2) * s.ampX2;
        const naturalY = (s.baseY * height) + Math.cos(time * s.fy1 + s.py1) * s.ampY1 + Math.sin(time * s.fy2 + s.py2) * s.ampY2;
        const naturalScale = 1.0 + Math.sin(time * s.fs + s.ps) * 0.15;

        // 2. Interacción fluida con el ratón (deflexión suave como agua líquida)
        const dmx = s.curX - mouse.x;
        const dmy = s.curY - mouse.y;
        const distMouse = Math.hypot(dmx, dmy);
        if (distMouse < 260 && distMouse > 10) {
          const force = (260 - distMouse) * 0.08;
          s.offsetX += (dmx / distMouse) * force * 0.07;
          s.offsetY += (dmy / distMouse) * force * 0.07;
        }

        // 3. Amortiguación elástica hacia el curso natural
        s.curX += (naturalX + s.offsetX - s.curX) * 0.055;
        s.curY += (naturalY + s.offsetY - s.curY) * 0.055;
        s.curScale += (naturalScale * s.boostScale - s.curScale) * 0.055;

        s.offsetX *= 0.94;
        s.offsetY *= 0.94;
        s.boostScale += (1.0 - s.boostScale) * 0.035;

        // 4. Transformación de Hardware acelerada por GPU (Compositor puro: 0ms Paint)
        const tx = Math.round(s.curX - s.radius);
        const ty = Math.round(s.curY - s.radius);
        s.el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s.curScale.toFixed(3)})`;
      }

      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);
  }

  /* ---- CSS AUTO-INYECTADO: AUTÉNTICO LIQUID GLASS (iOS 26 SPEC) ---- */
  function injectCSS() {
    if (document.getElementById('jjp-sidenav-css')) return;
    const css = `
    /* FLUJO DE AURORA LÍQUIDA (GPU ACCELERATED, 0% CPU, NUNCA SE CASEA) */
    .jjp-aurora-flow {
      position: fixed; inset: 0; width: 100vw; height: 100vh;
      pointer-events: none; z-index: 0;
      overflow: hidden; contain: strict;
      filter: blur(80px) saturate(220%);
      -webkit-filter: blur(80px) saturate(220%);
      opacity: 0.88;
      transition: opacity 0.6s ease;
    }

    [data-theme="light"] .jjp-aurora-flow {
      opacity: 0.38;
      filter: blur(90px) saturate(180%);
      -webkit-filter: blur(90px) saturate(180%);
    }

    .jjp-flow-stream {
      position: absolute; top: 0; left: 0;
      border-radius: 50%;
      pointer-events: none;
      will-change: transform;
      transform: translate3d(0, 0, 0);
      transition: background 0.85s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.85s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* BARRA LATERAL LIQUID GLASS */
    .admin-aside, aside.aside {
      background: rgba(8, 14, 26, 0.65) !important;
      backdrop-filter: blur(36px) saturate(220%) !important;
      -webkit-backdrop-filter: blur(36px) saturate(220%) !important;
      border-right: 1px solid rgba(255, 255, 255, 0.14) !important;
      box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.08), 10px 0 35px rgba(0, 0, 0, 0.4) !important;
      width: 240px !important;
      transition: width 0.32s cubic-bezier(0.2, 0.9, 0.3, 1) !important;
      z-index: 200 !important;
      display: flex !important;
      flex-direction: column !important;
    }

    /* MODO CLARO PARA LA BARRA */
    [data-theme="light"] .admin-aside, [data-theme="light"] aside.aside {
      background: rgba(255, 255, 255, 0.82) !important;
      border-right: 1px solid rgba(0, 0, 0, 0.08) !important;
      box-shadow: 10px 0 30px rgba(0, 0, 0, 0.06) !important;
    }

    .admin-main, main.admin-main {
      transition: margin-left 0.32s cubic-bezier(0.2, 0.9, 0.3, 1) !important;
      position: relative; z-index: 2;
    }
    body.sidebar-collapsed .admin-main,
    body.sidebar-collapsed main.admin-main {
      margin-left: 72px !important;
    }

    /* CABECERA DE LA BARRA */
    .aside-brand {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 16px 16px 14px !important;
      position: relative !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
      min-height: 68px; box-sizing: border-box;
    }
    .aside-brand-left {
      display: flex; align-items: center; gap: 10px; overflow: hidden; white-space: nowrap;
    }

    /* BOTÓN TOGGLE */
    .jjp-aside-toggle {
      width: 28px; height: 28px; border-radius: 9px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; flex-shrink: 0;
      backdrop-filter: blur(12px);
      box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.2);
      transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    .jjp-aside-toggle:hover {
      background: rgba(255, 255, 255, 0.20);
      transform: scale(1.08);
    }
    .jjp-aside-toggle .jjp-toggle-svg {
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
    }
    .admin-aside.collapsed .jjp-aside-toggle .jjp-toggle-svg {
      transform: rotate(180deg) !important;
    }

    /* LOGO CON AURA */
    .jjp-logo-animated {
      width: 38px; height: 38px; border-radius: 50%;
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      filter: drop-shadow(0 0 8px rgba(16, 185, 129, 0.55));
      animation: jjpLogoPulse 4s ease-in-out infinite;
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      flex-shrink: 0;
    }
    @keyframes jjpLogoPulse {
      0%   { filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.5)); }
      50%  { filter: drop-shadow(0 0 16px rgba(6, 182, 212, 0.85)); transform: scale(1.04); }
      100% { filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.5)); }
    }

    /* DESVANECIMIENTO SUAVE DE TEXTOS */
    .aside-brand span,
    .aside-brand em,
    .aside-nav .a-txt,
    .aside-nav .nav-caret,
    .aside-nav .a-section,
    .aside-ft .jjp-logout-txt,
    .aside-ft > div:first-child {
      white-space: nowrap;
      overflow: hidden;
      max-width: 170px;
      opacity: 1;
      transform: translateX(0);
      transition: opacity 0.20s ease, max-width 0.28s ease, transform 0.20s ease !important;
      display: inline-block;
    }

    /* ESTRUCTURA DE NAVEGACIÓN Y GRUPOS */
    .aside-nav {
      flex: 1 !important;
      padding: 10px 0 !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
    }

    .aside-nav .nav-group {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* BOTONES EN MODO EXPANDIDO */
    .aside-nav .nav-group-btn,
    .aside-nav > a {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      padding: 10px 14px !important;
      margin: 2px auto !important;
      width: calc(100% - 20px) !important;
      height: 42px !important;
      font-size: 13.5px !important; font-weight: 600 !important;
      color: rgba(255, 255, 255, 0.85) !important;
      background: none !important; border: 0 !important; cursor: pointer !important;
      font-family: inherit !important; text-align: left !important;
      border-radius: 12px !important;
      box-sizing: border-box !important;
      text-decoration: none !important;
      transition: width 0.30s cubic-bezier(0.2, 0.9, 0.3, 1),
                  height 0.30s cubic-bezier(0.2, 0.9, 0.3, 1),
                  padding 0.30s cubic-bezier(0.2, 0.9, 0.3, 1),
                  border-radius 0.30s cubic-bezier(0.2, 0.9, 0.3, 1),
                  background 0.20s ease,
                  box-shadow 0.20s ease !important;
    }
    .aside-nav .nav-group-btn:hover,
    .aside-nav > a:hover {
      background: rgba(255, 255, 255, 0.10) !important; color: #fff !important;
      box-shadow: 0 0 16px var(--cat-glow, transparent), inset 0 1px 1px rgba(255, 255, 255, 0.2) !important;
    }
    .aside-nav .nav-group-btn .a-ico,
    .aside-nav > a .a-ico {
      width: 22px !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important;
      color: var(--cat-color, #10b981) !important;
      filter: drop-shadow(0 0 6px var(--cat-color, transparent)) !important;
      transition: transform 0.25s ease !important;
    }
    .aside-nav .nav-group-btn .a-txt,
    .aside-nav > a .a-txt { flex: 1 !important; }
    .aside-nav .nav-caret {
      font-size: 11px !important; opacity: .7 !important; transition: transform .28s ease !important; flex-shrink: 0 !important;
    }
    .aside-nav .nav-group.open .nav-caret { transform: rotate(180deg) !important; }
    .aside-nav .nav-group.has-active > .nav-group-btn { color: #fff !important; font-weight: 700 !important; }

    /* SUBMENÚ ACORDEÓN EXPANDIBLE */
    .aside-nav .nav-sub {
      display: grid !important; grid-template-rows: 0fr !important;
      transition: grid-template-rows .28s cubic-bezier(0.16, 1, 0.3, 1) !important;
      background: rgba(0, 0, 0, .24) !important;
      border-radius: 10px !important; margin: 0 10px 4px 10px !important;
      width: calc(100% - 20px) !important;
    }
    .aside-nav .nav-group.open .nav-sub { grid-template-rows: 1fr !important; }
    .aside-nav .nav-sub > * { min-height: 0; overflow: hidden; }
    .aside-nav .nav-sub a {
      padding: 9px 12px 9px 36px !important; font-size: 12.5px !important;
      color: rgba(255, 255, 255, .75) !important;
      transition: all 0.18s ease !important;
      text-decoration: none !important; display: flex !important; align-items: center !important; gap: 10px !important;
    }
    .aside-nav .nav-sub a:hover { color: #fff !important; background: rgba(255, 255, 255, .12) !important; padding-left: 40px !important; }
    .aside-nav .nav-sub a.on {
      background: var(--cat-glow, rgba(16, 185, 129, 0.25)) !important; color: #fff !important;
      border-left: 3px solid var(--cat-color, #10b981) !important;
      font-weight: 700 !important;
    }

    /* ==============================================================
       ESTADO COLAPSADO: CUADROS LIQUID GLASS CON ESPACIADO HOMOGÉNEO (CERO ROTURA)
       ============================================================== */
    .admin-aside.collapsed, aside.aside.collapsed {
      width: 72px !important;
    }

    /* ELIMINAR HUECOS VERTICALES FANTASMA */
    .admin-aside.collapsed .a-section,
    .admin-aside.collapsed .divider {
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
      position: absolute; bottom: -12px; right: 22px; z-index: 10;
    }

    /* Desvanecer textos sin alterar la geometría de la barra */
    .admin-aside.collapsed .aside-brand span,
    .admin-aside.collapsed .aside-brand em,
    .admin-aside.collapsed .aside-nav .a-txt,
    .admin-aside.collapsed .aside-nav .nav-caret,
    .admin-aside.collapsed .aside-ft .jjp-logout-txt,
    .admin-aside.collapsed .aside-ft > div:first-child {
      opacity: 0 !important;
      max-width: 0 !important;
      transform: translateX(-10px) !important;
      pointer-events: none !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* Ocultar submenú acordeón en colapsado (para usar tarjeta flotante) */
    .admin-aside.collapsed .nav-sub {
      display: none !important;
    }

    .admin-aside.collapsed .aside-nav {
      gap: 6px !important;
      padding: 12px 0 !important;
    }

    /* SQUIRCLES PERFECTAMENTE CENTRADOS Y COMPACTOS */
    .admin-aside.collapsed .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a {
      width: 48px !important;
      height: 48px !important;
      padding: 0 !important;
      margin: 0 auto !important;
      border-radius: 14px !important;
      justify-content: center !important;
      background: rgba(255, 255, 255, 0.06) !important;
      backdrop-filter: blur(18px) saturate(200%) !important;
      -webkit-backdrop-filter: blur(18px) saturate(200%) !important;
      border: 1px solid rgba(255, 255, 255, 0.16) !important;
      box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.28), 0 4px 16px var(--cat-glow, rgba(0,0,0,0.25)) !important;
      cursor: pointer !important;
    }

    .admin-aside.collapsed .nav-group-btn .a-ico,
    .admin-aside.collapsed .aside-nav > a .a-ico {
      width: auto !important;
      margin: 0 !important;
      color: var(--cat-color, #10b981) !important;
      filter: drop-shadow(0 0 8px var(--cat-color, #10b981)) !important;
      transform: scale(1.08) !important;
    }

    .admin-aside.collapsed .nav-group:hover .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a:hover {
      transform: scale(1.10) translateY(-2px) !important;
      background: rgba(255, 255, 255, 0.16) !important;
      border-color: var(--cat-color, rgba(255, 255, 255, 0.45)) !important;
      box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.4), 0 0 24px var(--cat-glow, rgba(16, 185, 129, 0.5)) !important;
    }

    .admin-aside.collapsed .nav-group.has-active .nav-group-btn,
    .admin-aside.collapsed .aside-nav > a.on {
      border-color: var(--cat-color, #10b981) !important;
      background: var(--cat-glow, rgba(16, 185, 129, 0.28)) !important;
      box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.35), 0 0 20px var(--cat-glow, rgba(16, 185, 129, 0.6)) !important;
    }

    /* ==============================================================
       TARJETA FLOTANTE LIQUID GLASS (FLYOUT EN MODO COLAPSADO)
       ============================================================== */
    .jjp-liquid-flyout-card {
      position: fixed;
      width: 250px;
      background: rgba(10, 16, 28, 0.82) !important;
      backdrop-filter: blur(40px) saturate(240%) !important;
      -webkit-backdrop-filter: blur(40px) saturate(240%) !important;
      border: 1.5px solid var(--cat-color, rgba(255, 255, 255, 0.28)) !important;
      border-radius: 20px !important;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75), 0 0 35px var(--cat-glow, transparent), inset 0 1px 2px rgba(255, 255, 255, 0.35) !important;
      padding: 12px !important;
      z-index: 999999 !important;
      animation: jjpFlyoutScale 0.20s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    [data-theme="light"] .jjp-liquid-flyout-card {
      background: rgba(255, 255, 255, 0.90) !important;
      border: 1.5px solid var(--cat-color, rgba(0, 0, 0, 0.15)) !important;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.15), 0 0 25px var(--cat-glow, transparent) !important;
    }

    [data-theme="light"] .flyout-hd-title,
    [data-theme="light"] .flyout-item {
      color: #0f172a !important;
    }

    @keyframes jjpFlyoutScale {
      0%   { opacity: 0; transform: translateX(-10px) scale(0.92); }
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
      color: rgba(255, 255, 255, 0.85) !important;
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
      width: 48px !important;
      height: 48px !important;
      padding: 0 !important;
      margin: 8px auto !important;
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

    /* PÍLDORA Y PALETA DE COMANDOS (Ctrl+K) */
    .jjp-cmd-pill {
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      margin: 8px 14px 10px !important; padding: 7px 12px !important; border-radius: 10px !important;
      background: rgba(255, 255, 255, 0.06) !important; border: 1px solid rgba(255, 255, 255, 0.14) !important;
      color: rgba(255, 255, 255, 0.78) !important; font-size: 12px !important; font-weight: 600 !important;
      cursor: pointer !important; transition: all .18s !important; backdrop-filter: blur(8px) !important;
    }
    .jjp-cmd-pill:hover {
      background: rgba(255, 255, 255, 0.14) !important; color: #fff !important; border-color: rgba(255, 255, 255, 0.25) !important;
    }
    .jjp-cmd-pill kbd {
      background: rgba(0, 0, 0, 0.35) !important; border: 1px solid rgba(255, 255, 255, 0.2) !important;
      border-radius: 4px !important; padding: 1px 5px !important; font-size: 10px !important; font-family: monospace !important; color: #fff !important;
    }
    [data-theme="light"] .jjp-cmd-pill {
      background: rgba(0, 0, 0, 0.04) !important; border-color: rgba(0, 0, 0, 0.1) !important; color: #475569 !important;
    }
    [data-theme="light"] .jjp-cmd-pill:hover {
      background: rgba(0, 0, 0, 0.08) !important; color: #0f172a !important;
    }
    [data-theme="light"] .jjp-cmd-pill kbd {
      background: #e2e8f0 !important; border-color: #cbd5e1 !important; color: #0f172a !important;
    }
    .admin-aside.collapsed .jjp-cmd-pill {
      display: none !important;
    }

    .jjp-palette-mask {
      position: fixed !important; inset: 0 !important; background: rgba(10, 16, 28, 0.72) !important;
      backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
      z-index: 1000000 !important; display: none !important; align-items: flex-start !important; justify-content: center !important;
      padding-top: 12vh !important;
    }
    .jjp-palette-mask.open {
      display: flex !important;
    }
    .jjp-palette-box {
      width: 100% !important; max-width: 580px !important; background: #ffffff !important;
      border-radius: 16px !important; box-shadow: 0 24px 60px rgba(0,0,0,0.45) !important;
      overflow: hidden !important; border: 1px solid rgba(255,255,255,0.2) !important;
      animation: jjpPop 0.16s ease-out !important;
    }
    [data-theme="dark"] .jjp-palette-box {
      background: #0f172a !important; border-color: rgba(255, 255, 255, 0.16) !important; color: #f8fafc !important;
    }
    @keyframes jjpPop { from { transform: scale(0.96); opacity: 0; } to { transform: scale(1); opacity: 1; } }
    .jjp-palette-input-wrap {
      display: flex !important; align-items: center !important; padding: 14px 18px !important;
      border-bottom: 1px solid #e2e8f0 !important; gap: 12px !important; background: inherit !important;
    }
    [data-theme="dark"] .jjp-palette-input-wrap {
      border-bottom-color: rgba(255, 255, 255, 0.1) !important;
    }
    .jjp-palette-search-icon { font-size: 18px !important; opacity: 0.7 !important; }
    #jjpPaletteInput {
      flex: 1 !important; border: 0 !important; outline: 0 !important; font-size: 15px !important;
      font-family: inherit !important; color: #0f172a !important; background: transparent !important;
    }
    [data-theme="dark"] #jjpPaletteInput { color: #f8fafc !important; }
    .jjp-palette-badge {
      font-size: 11px !important; background: rgba(0,0,0,0.06) !important; color: #64748b !important; padding: 3px 7px !important;
      border-radius: 4px !important; font-weight: 600 !important;
    }
    [data-theme="dark"] .jjp-palette-badge { background: rgba(255,255,255,0.08) !important; color: #94a3b8 !important; }
    .jjp-palette-list {
      max-height: 380px !important; overflow-y: auto !important; padding: 8px !important;
    }
    .jjp-palette-item {
      display: flex !important; align-items: center !important; gap: 12px !important; padding: 10px 14px !important;
      border-radius: 10px !important; cursor: pointer !important; transition: background 0.15s !important;
    }
    .jjp-palette-item.active {
      background: #f0fdf4 !important; color: #166534 !important;
    }
    [data-theme="dark"] .jjp-palette-item.active {
      background: rgba(16, 185, 129, 0.22) !important; color: #34d399 !important;
    }
    .jjp-palette-item-icon { font-size: 18px !important; display: flex !important; align-items: center !important; }
    .jjp-palette-item-text { flex: 1 !important; min-width: 0 !important; }
    .jjp-palette-item-title { font-weight: 700 !important; font-size: 13.5px !important; color: inherit !important; }
    .jjp-palette-item-sub { font-size: 11.5px !important; opacity: 0.7 !important; }
    .jjp-palette-item-arrow { opacity: 0.3 !important; font-size: 13px !important; font-weight: 800 !important; }
    .jjp-palette-item.active .jjp-palette-item-arrow { opacity: 1 !important; }
    .jjp-palette-footer {
      display: flex !important; gap: 16px !important; padding: 10px 18px !important; background: rgba(0,0,0,0.02) !important;
      border-top: 1px solid #e2e8f0 !important; font-size: 11px !important; color: #64748b !important;
    }
    [data-theme="dark"] .jjp-palette-footer {
      background: rgba(0,0,0,0.2) !important; border-top-color: rgba(255, 255, 255, 0.08) !important; color: #94a3b8 !important;
    }
    .jjp-palette-footer kbd {
      background: rgba(0,0,0,0.06) !important; border: 1px solid rgba(0,0,0,0.1) !important; border-radius: 3px !important; padding: 1px 4px !important;
    }
    [data-theme="dark"] .jjp-palette-footer kbd {
      background: rgba(255,255,255,0.1) !important; border-color: rgba(255,255,255,0.18) !important; color: #fff !important;
    }
    .jjp-palette-empty {
      padding: 30px !important; text-align: center !important; color: #94a3b8 !important; font-size: 14px !important;
    }
    `;
    const style = document.createElement('style');
    style.id = 'jjp-sidenav-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function escapeHTML(str) {
    return String(str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function loadKeyboardNav() {
    if (document.getElementById('jjp-keyboard-nav-script') || window.__JJ_KEYBOARD_NAV_INITIALIZED__) return;
    const s = document.createElement('script');
    s.id = 'jjp-keyboard-nav-script';
    s.src = '../assets/js/keyboard-nav.js?v=20261103_hub';
    document.head.appendChild(s);
  }

  function initCommandPalette() {
    if (window.__jjpCmdPaletteInit) return;
    window.__jjpCmdPaletteInit = true;

    const aside = document.querySelector('.admin-aside') || document.querySelector('aside.aside');
    const asideBrand = aside?.querySelector('.aside-brand');
    if (asideBrand && !document.getElementById('jjpCmdPill')) {
      const pill = document.createElement('div');
      pill.id = 'jjpCmdPill';
      pill.className = 'jjp-cmd-pill';
      pill.innerHTML = `<span>🧭 Ir a módulo...</span><kbd>Ctrl+K</kbd>`;
      pill.onclick = togglePalette;
      asideBrand.parentNode.insertBefore(pill, asideBrand.nextSibling);
    }

    let flatItems = [];
    let curCursor = 0;

    function buildFlatItems() {
      flatItems = [];
      NAV.forEach(n => {
        if (n.group && n.items) {
          n.items.forEach(it => {
            flatItems.push({
              title: it.label,
              icon: it.ico || '📄',
              group: n.group,
              href: absHref(it.href),
              ext: !!it.ext
            });
          });
        } else if (n.href && !n.section) {
          flatItems.push({
            title: n.label,
            icon: n.ico || '📄',
            group: 'Principal',
            href: absHref(n.href),
            ext: !!n.ext
          });
        }
      });
    }

    function openPalette() {
      buildFlatItems();
      curCursor = 0;
      let modal = document.getElementById('jjpCmdPaletteModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'jjpCmdPaletteModal';
        modal.className = 'jjp-palette-mask open';
        modal.style.cssText = 'display:flex !important;';
        modal.innerHTML = `
          <div class="jjp-palette-box" role="dialog" aria-modal="true" aria-label="Navegador Rápido">
            <div class="jjp-palette-input-wrap">
              <span class="jjp-palette-search-icon">🔍</span>
              <input type="text" id="jjpPaletteInput" placeholder="Escribe para ir a cualquier módulo (ej. pos, cotizador, clientes, whatsapp)..." autocomplete="off">
              <span class="jjp-palette-badge">ESC para cerrar</span>
            </div>
            <div class="jjp-palette-list" id="jjpPaletteList"></div>
            <div class="jjp-palette-footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
              <span><kbd>Enter</kbd> abrir</span>
              <span><kbd>Esc</kbd> cerrar</span>
            </div>
          </div>
        `;
        document.body.appendChild(modal);

        modal.addEventListener('mousedown', e => {
          if (e.target === modal) closePalette();
        });

        const inp = modal.querySelector('#jjpPaletteInput');
        inp.addEventListener('input', renderPaletteItems);
      } else {
        modal.style.display = 'flex';
        modal.classList.add('open');
      }

      const inp = document.getElementById('jjpPaletteInput');
      if (inp) {
        inp.value = '';
        renderPaletteItems();
        setTimeout(() => inp.focus(), 30);
      }
    }

    function closePalette() {
      const modal = document.getElementById('jjpCmdPaletteModal');
      if (modal) modal.remove();
    }

    function togglePalette() {
      const modal = document.getElementById('jjpCmdPaletteModal');
      if (modal) closePalette();
      else openPalette();
    }

    window.__jjpOpenCommandPalette = openPalette;
    window.__jjpCloseCommandPalette = closePalette;
    window.__jjpToggleCommandPalette = togglePalette;

    function renderPaletteItems() {
      const modal = document.getElementById('jjpCmdPaletteModal');
      if (!modal) return;
      const q = (document.getElementById('jjpPaletteInput')?.value || '').trim().toLowerCase();
      const listEl = document.getElementById('jjpPaletteList');
      if (!listEl) return;
      const filtered = flatItems.filter(it => 
        !q || it.title.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)
      );

      if (!filtered.length) {
        listEl.innerHTML = `<div class="jjp-palette-empty">No se encontraron módulos con "${escapeHTML(q)}"</div>`;
        return;
      }

      if (curCursor >= filtered.length) curCursor = 0;
      if (curCursor < 0) curCursor = 0;

      listEl.innerHTML = filtered.map((it, idx) => `
        <div class="jjp-palette-item ${idx === curCursor ? 'active' : ''}" data-idx="${idx}">
          <span class="jjp-palette-item-icon">${it.icon}</span>
          <div class="jjp-palette-item-text">
            <div class="jjp-palette-item-title">${escapeHTML(it.title)}</div>
            <div class="jjp-palette-item-sub">${escapeHTML(it.group)}</div>
          </div>
          <span class="jjp-palette-item-arrow">↵</span>
        </div>
      `).join('');

      const items = listEl.querySelectorAll('.jjp-palette-item');
      items.forEach(el => {
        el.addEventListener('mouseenter', () => {
          curCursor = Number(el.dataset.idx);
          items.forEach((x, i) => x.classList.toggle('active', i === curCursor));
        });
        el.addEventListener('click', () => {
          executeItem(filtered[curCursor]);
        });
      });

      items[curCursor]?.scrollIntoView({ block: 'nearest' });
    }

    function executeItem(item) {
      if (!item) return;
      closePalette();
      if (item.ext) window.open(item.href, '_blank');
      else window.location.href = item.href;
    }

    function onPaletteKey(e) {
      const modal = document.getElementById('jjpCmdPaletteModal');
      if (!modal) return;
      const q = (document.getElementById('jjpPaletteInput')?.value || '').trim().toLowerCase();
      const filtered = flatItems.filter(it => 
        !q || it.title.toLowerCase().includes(q) || it.group.toLowerCase().includes(q)
      );

      if (e.key === 'Escape') {
        e.preventDefault();
        closePalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) {
          curCursor = (curCursor + 1) % filtered.length;
          renderPaletteItems();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) {
          curCursor = (curCursor - 1 + filtered.length) % filtered.length;
          renderPaletteItems();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered.length && filtered[curCursor]) {
          executeItem(filtered[curCursor]);
        }
        return;
      }
    }

    window.addEventListener('keydown', onPaletteKey);

    window.addEventListener('keydown', e => {
      if (e.defaultPrevented) return;
      if ((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
      }
    });
  }

  function initModalScrollBridge() {
    document.addEventListener('wheel', (e) => {
      const overlay = e.target.closest('.modal-overlay.op, .modal-overlay.open');
      if (!overlay) return;
      const body = overlay.querySelector('.modal-body');
      if (!body) return;
      if (e.target.closest('.modal-hd') || e.target === overlay || e.target.closest('.modal-ft')) {
        body.scrollTop += e.deltaY;
      }
    }, { passive: true });
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
    loadKeyboardNav();
    initCommandPalette();
    initModalScrollBridge();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
