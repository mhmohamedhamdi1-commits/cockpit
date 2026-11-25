// Service worker : application disponible hors ligne + réception des notifications push.
// BUILD et ASSETS sont injectés au déploiement (tools/cloud/deploy.mjs).
const BUILD = '__BUILD__';
const ASSETS = __ASSETS__;
const CACHE = 'cockpit-' + BUILD;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('cockpit-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // API Supabase : jamais en cache
  if (req.mode === 'navigate') {                                // page : réseau d'abord, cache si hors ligne
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put('/index.html', c)); return r; })
      .catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); }
    return r;
  })));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Cockpit', body: e.data && e.data.text() }; }
  const title = d.title || 'Cockpit';
  const opts = { body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/badge-72.png', tag: d.tag || undefined, data: { url: d.url || '/' }, renotify: !!d.tag };
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    typeof d.badge === 'number' && self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(d.badge).catch(() => {}) : null,
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin)) { c.navigate(target).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
