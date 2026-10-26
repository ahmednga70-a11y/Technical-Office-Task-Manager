import { removeOfficePushSubscription } from '@workspace/api-client-react';

export const officeWorkerScope = import.meta.env.BASE_URL;
export const pushPreferenceKey = (memberId?: number) => `office-phone-push:${memberId ?? 'pending'}`;

export function pushSupported() {
  return window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

export function applicationServerKey(value: string): ArrayBuffer {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

export async function officeWorker() {
  const registration = await navigator.serviceWorker.register(
    `${officeWorkerScope}office-sw.js`, { scope: officeWorkerScope, updateViaCache: 'none' },
  );
  if (!registration.active) {
    await new Promise<void>((resolve, reject) => {
      const worker = registration.installing ?? registration.waiting;
      if (!worker) { reject(new Error('worker-unavailable')); return; }
      const timeout = window.setTimeout(() => { worker.removeEventListener('statechange', changed); reject(new Error('worker-timeout')); }, 15_000);
      const changed = () => {
        if (worker.state === 'activated') { clearTimeout(timeout); worker.removeEventListener('statechange', changed); resolve(); }
        else if (worker.state === 'redundant') { clearTimeout(timeout); worker.removeEventListener('statechange', changed); reject(new Error('worker-unavailable')); }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  return registration;
}

export function subscriptionInput(subscription: PushSubscription) {
  const data = subscription.toJSON();
  if (!data.keys?.p256dh || !data.keys.auth) throw new Error('subscription-keys-unavailable');
  return { endpoint: subscription.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } };
}

export async function disableCurrentPushDevice(memberId?: number) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(officeWorkerScope);
  const subscription = await registration?.pushManager?.getSubscription();
  if (!subscription) {
    try { localStorage.setItem(pushPreferenceKey(memberId), 'off'); } catch { /* Optional preference. */ }
    return;
  }
  // Revoking either the browser capability or our member-owned server record
  // is sufficient to prevent further delivery to this signed-out device.
  const results = await Promise.allSettled([
    subscription.unsubscribe(),
    removeOfficePushSubscription({ endpoint: subscription.endpoint }),
  ]);
  const browserRevoked = results[0].status === 'fulfilled' && results[0].value;
  const serverRevoked = results[1].status === 'fulfilled';
  if (!browserRevoked && !serverRevoked) throw new Error('push-unsubscribe-failed');
  try { localStorage.setItem(pushPreferenceKey(memberId), 'off'); } catch { /* Optional preference. */ }
}
