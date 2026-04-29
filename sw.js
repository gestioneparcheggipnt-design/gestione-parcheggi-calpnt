// sw.js — Service Worker CalPnt Mobile
// Forza sempre il network per JS e CSS: nessun file viene mai servito dalla cache.
// Per tutti gli altri asset (immagini, font esterni, Firebase SDK) usa cache-first.

const CACHE_NAME = 'calpnt-v1';

// File dell'app da servire sempre freschi dal network
const NETWORK_FIRST = [
  // Mobile
  'mobile.html',
  'mobile-styles.css',
  // Desktop
  'index-shell.html',
  'index.html',
  'index-styles.css',
  'prenotazioni-desktop.js',
  'parking-ops.js',
  'admin-desktop.js',
  // Condivisi
  'firebase-config.js',
  'spots-data.js',
  'shared-utils.js',
  'checkin.js',
  'prenotazioni-autista.js',
  'ribalte-operativo.js',
];

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Prende il controllo di tutte le tab aperte immediatamente
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const filename = url.pathname.split('/').pop();

  // Se è uno dei file dell'app: sempre network, mai cache
  if (NETWORK_FIRST.some(f => filename === f || url.pathname.endsWith('/' + f))) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match(event.request)) // fallback offline: usa cache se rete assente
    );
    return;
  }

  // Per tutto il resto (font Google, Firebase SDK CDN): cache normale
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request);
    })
  );
});
