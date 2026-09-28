// Shows "your turn" alerts and opens the right game when one is tapped.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Always the newest game code. GitHub Pages lets a browser keep a file for 10 minutes, so right
// after an update a page could run the old script (a 6-tank duel where only one robot fired).
// The site's own pages, scripts and styles are re-checked with the server on every load instead:
// an unchanged file costs a quick "not modified", a changed one arrives at once. Pictures and
// everything off-site (the database) are left alone.
self.addEventListener('fetch', (e) => {
  const r = e.request, url = new URL(r.url);
  if (r.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!(r.mode === 'navigate' || /\.(js|css|html|json)$/.test(url.pathname) || url.pathname.endsWith('/'))) return;
  e.respondWith(fetch(r.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((res) => (res.redirected && r.mode === 'navigate' ? Response.redirect(res.url, 302) : res))   // e.g. /game-room → /game-room/
    .catch(() => fetch(r)));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Family Game Room', {
    body: d.body || '',
    tag: d.tag,
    renotify: true,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: d.url || './' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        w.postMessage({ url });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
