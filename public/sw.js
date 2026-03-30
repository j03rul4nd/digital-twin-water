/**
 * sw.js — Service Worker para WTP Digital Twin PWA.
 *
 * Estrategia: Cache First para assets estáticos, Network First para datos.
 * El simulador funciona 100% offline — los datos MQTT solo requieren red.
 *
 * Cache versionado — al actualizar la app, el SW invalida el cache anterior.
 */

const CACHE_VERSION = 'wtp-twin-v1';
const CACHE_NAME    = `${CACHE_VERSION}`;

// Assets que se cachean en la instalación — shell de la app
const PRECACHE_ASSETS = [
  './',
  './index.html',
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      // Activar inmediatamente sin esperar a que se cierre la pestaña anterior
      return self.skipWaiting();
    })
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // Tomar control de todas las pestañas abiertas inmediatamente
      return self.clients.claim();
    })
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // No interceptar peticiones MQTT, MCP bridge, o APIs externas
  if (
    url.hostname !== self.location.hostname ||
    url.port === '3001' ||   // mcp-bridge-server
    url.protocol === 'ws:' ||
    url.protocol === 'wss:'
  ) {
    return;
  }

  // Estrategia: Stale While Revalidate para assets de la app
  // — sirve desde cache inmediatamente, actualiza en background
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);

      const fetchPromise = fetch(event.request)
        .then((response) => {
          // Solo cachear respuestas válidas de assets estáticos
          if (
            response.ok &&
            response.type === 'basic' &&
            event.request.method === 'GET'
          ) {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => {
          // Sin red — devolver cache si existe
          return cached;
        });

      // Devolver cache inmediatamente si existe, actualizar en background
      return cached || fetchPromise;
    })
  );
});