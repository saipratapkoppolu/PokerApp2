// Minimal service worker: lets the app show blind-level notifications (Android requires
// a service worker for notifications) and makes the site installable to the home screen.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Network passthrough — the app needs live Firebase data, so nothing is cached.
self.addEventListener('fetch', () => {});

// Push notifications from the app's worker (Firebase Cloud Messaging): show them, with the link to open.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const note = payload.notification || {};
  const link = (payload.data && payload.data.link) || (payload.fcmOptions && payload.fcmOptions.link) || '/';
  if (!note.title) return;
  event.waitUntil(self.registration.showNotification(note.title, { body: note.body || '', icon: '/icon.svg', data: { link } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      // A notification's link (a poll or game) opens in the app's tab, or a new one.
      if (existing && link !== '/') return existing.navigate(link).then((c) => c && c.focus());
      if (existing) return existing.focus();
      return self.clients.openWindow(link);
    })
  );
});
