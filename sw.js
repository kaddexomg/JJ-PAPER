/* ======================================================
   JJ Paper — Service Worker (Caché Inteligente de Catálogo e Imágenes)
   Garantiza carga instantánea en PC, laptop y teléfono móvil.
   ====================================================== */

const CACHE_NAME = 'jjp-static-v10';
const IMAGE_CACHE_NAME = 'jjp-images-v2';

const STATIC_ASSETS = [
  './',
  './catalogo.html',
  './producto.html',
  './catalogo_impreso.html',
  './index.html',
  './assets/css/catalog.css',
  './assets/css/quote-drawer.css',
  './assets/css/variables.css',
  './assets/css/components.css',
  './assets/css/responsive.css',
  './assets/js/config.js',
  './assets/js/catalog.js',
  './assets/js/quote-drawer.js',
  './assets/js/product-detail.js',
  './assets/js/nav.js',
  './assets/js/product-modal.js',
  './assets/js/gemini-client.js',
  './assets/js/toast.js',
  './assets/img/logo.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching asset warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME && k !== IMAGE_CACHE_NAME)
            .map((k) => {
              console.log('[SW] Purgando caché obsoleta:', k);
              return caches.delete(k);
            })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. Caché persistente de Imágenes de Productos (Supabase Storage WebP)
  if ((url.hostname.includes('166-0-112-247.sslip.io') || url.hostname.includes('166.0.112.247')) && url.pathname.includes('/storage/v1/object/public/jjp-products')) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.status === 200) {
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          return cached || new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // 2. Páginas HTML de navegación: SIEMPRE IR A RED (Network First)
  // Esto previene que al actualizar código el usuario siga viendo la versión vieja en caché
  if (req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/' || !url.pathname.includes('.')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // 3. Assets con parámetro de versión (?v=): SIEMPRE IR A RED (Network First)
  // Garantiza que cuando se actualiza la versión del código (?v=...), se cargue el código nuevo de inmediato
  if (url.searchParams.has('v')) {
    event.respondWith(
      fetch(req).then((netRes) => {
        if (netRes && netRes.status === 200) {
          const clone = netRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return netRes;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // 4. Assets estáticos sin versión (CSS, JS, SVG): Stale-While-Revalidate
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((netRes) => {
          if (netRes && netRes.status === 200) {
            const clone = netRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return netRes;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
  }
});
