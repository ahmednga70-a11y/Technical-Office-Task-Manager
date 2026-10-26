/* Push-only worker: no page/asset caching, to avoid serving outdated app code. */
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });

function appUrl(path) {
  const scope = new URL(self.registration.scope);
  const url = new URL(typeof path === 'string' ? path : 'dashboard', scope);
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname)
    ? url.href : new URL('dashboard', scope).href;
}

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Show a safe generic notification. */ }
  event.waitUntil((async () => {
    await self.registration.showNotification(
      typeof data.title === 'string' ? data.title.slice(0, 120) : 'فريق المكتب الفني',
      {
        body: typeof data.body === 'string' ? data.body.slice(0, 240) : 'لديك تنبيه جديد في مهام المكتب.',
        icon: new URL('pwa-192.png', self.registration.scope).href,
        badge: new URL('pwa-192.png', self.registration.scope).href,
        lang: 'ar', dir: 'rtl', silent: false,
        tag: `office-notification-${String(data.id || 'new').slice(0, 80)}`,
        renotify: false,
        data: { url: appUrl(data.path) },
      },
    );
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach(client => client.postMessage({ type: 'OFFICE_PUSH_RECEIVED' }));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = appUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url.startsWith(self.registration.scope));
    if (existing) {
      const navigated = await existing.navigate(url);
      if (navigated) { await navigated.focus(); return; }
    }
    await self.clients.openWindow(url);
  })());
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const response = await fetch(new URL('api/office/push/config', self.registration.scope), { credentials: 'include' });
      if (!response.ok) throw new Error('sign-in-required');
      const config = await response.json();
      if (!config.configured || !config.publicKey) throw new Error('configuration-required');
      const raw = atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
      const key = Uint8Array.from(raw, char => char.charCodeAt(0));
      const subscription = event.newSubscription || await self.registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: key,
      });
      const saved = await fetch(new URL('api/office/push/subscriptions', self.registration.scope), {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!saved.ok) throw new Error('subscription-save-failed');
    } catch {
      await self.registration.showNotification('تحديث تنبيهات الهاتف', {
        body: 'افتح التطبيق وأعد تفعيل التنبيهات لهذا الجهاز لاستمرار استقبالها.',
        icon: new URL('pwa-192.png', self.registration.scope).href,
        tag: 'office-push-renewal', data: { url: appUrl('dashboard') }, lang: 'ar', dir: 'rtl',
      });
    }
  })());
});
