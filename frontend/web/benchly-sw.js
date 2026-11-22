// Benchly PWA Network-First Service Worker + W3C VAPID Background Push Handler
// Guarantees zero stale main.dart.js / CanvasKit caching while enabling standalone PWA install & background Web Push.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        for (const k of keys) {
          await caches.delete(k);
        }
      } catch (_) {}
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});

// W3C Web Push (VAPID) handler — wakes up even when the browser tab / PWA is completely closed!
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Benchly — EWU Campus Adda',
    body: 'Something new is happening on the campus benches!',
    tag: 'benchly_push',
    url: '/'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        payload = {
          title: parsed.title || payload.title,
          body: parsed.body || payload.body,
          tag: parsed.tag || payload.tag,
          url: parsed.url || payload.url
        };
      }
    }
  } catch (_) {
    try {
      if (event.data) payload.body = event.data.text();
    } catch (_) {}
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: 'icons/Icon-192.png',
      badge: 'icons/Icon-192.png',
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })()
  );
});
