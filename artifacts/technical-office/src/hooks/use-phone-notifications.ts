import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getOfficePushConfig, saveOfficePushSubscription, testOfficePushDevice,
  getListOfficeNotificationsQueryKey,
} from '@workspace/api-client-react';
import {
  applicationServerKey, disableCurrentPushDevice, officeWorker, officeWorkerScope,
  pushPreferenceKey, pushSupported, subscriptionInput,
} from '@/lib/office-push';

function message(error: unknown, fallback: string) {
  const value = (error as { data?: { error?: unknown } })?.data?.error;
  return typeof value === 'string' && /[\u0600-\u06ff]/.test(value) ? value : fallback;
}

export function usePhoneNotifications(memberId?: number) {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<{ configured: boolean; publicKey: string | null } | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [checkVersion, setCheckVersion] = useState(0);
  const supported = pushSupported();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const needsInstallation = isIOS && !window.matchMedia('(display-mode: standalone)').matches
    && !(navigator as Navigator & { standalone?: boolean }).standalone;

  useEffect(() => {
    if (!memberId || !supported || needsInstallation) return;
    let cancelled = false;
    void (async () => {
      try {
        const value = await getOfficePushConfig();
        if (cancelled) return;
        setConfig(value);
        if (!value.configured || !value.publicKey || Notification.permission !== 'granted') return;
        let preference: string | null = null;
        try { preference = localStorage.getItem(pushPreferenceKey(memberId)); } catch { /* Session-only preference. */ }
        const registration = await navigator.serviceWorker.getRegistration(officeWorkerScope);
        const subscription = await registration?.pushManager.getSubscription();
        if (preference !== 'on') {
          // A shared browser must not retain a previous member's capability
          // after cookies are cleared or accounts change without normal logout.
          if (subscription) await disableCurrentPushDevice(memberId);
          return;
        }
        if (!subscription) return;
        await saveOfficePushSubscription(subscriptionInput(subscription));
        if (!cancelled) setEnabled(true);
      } catch (cause) {
        if (!cancelled) setError(message(cause, 'تعذّر فحص تنبيهات الهاتف. تحقق من الاتصال واضغط إعادة الفحص.'));
      }
    })();
    const onPush = (event: MessageEvent) => {
      if (event.data?.type === 'OFFICE_PUSH_RECEIVED') {
        void queryClient.invalidateQueries({ queryKey: getListOfficeNotificationsQueryKey() });
      }
    };
    navigator.serviceWorker.addEventListener('message', onPush);
    return () => { cancelled = true; navigator.serviceWorker.removeEventListener('message', onPush); };
  }, [memberId, supported, needsInstallation, queryClient, checkVersion]);

  const enable = async () => {
    if (!config?.publicKey || !config.configured || !memberId || busy) return;
    setBusy(true); setError(''); setNotice('');
    let subscription: PushSubscription | null = null;
    try {
      // Permission requests must remain in the explicit button gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError(permission === 'denied'
          ? 'تنبيهات الموقع محظورة. اسمح بها من إعدادات الموقع في المتصفح، ثم أعد المحاولة.'
          : 'لم تسمح بالتنبيهات. يمكنك تفعيلها لاحقًا من هذا الزر.');
        return;
      }
      const registration = await officeWorker();
      subscription = await registration.pushManager.getSubscription();
      const key = applicationServerKey(config.publicKey);
      if (subscription?.options.applicationServerKey
        && new Uint8Array(subscription.options.applicationServerKey).toString() !== new Uint8Array(key).toString()) {
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await saveOfficePushSubscription(subscriptionInput(subscription));
      try { localStorage.setItem(pushPreferenceKey(memberId), 'on'); } catch { /* Session-only preference. */ }
      setEnabled(true); setNotice('تم تفعيل تنبيهات هذا الجهاز. يمكنك إرسال تنبيه تجريبي.');
    } catch (cause) {
      if (subscription) { try { await subscription.unsubscribe(); } catch { /* Expired capabilities are removed by sender. */ } }
      setError(message(cause, 'تعذّر تفعيل تنبيهات الهاتف. تحقق من السماح بالتنبيهات واتصال الإنترنت.'));
    } finally { setBusy(false); }
  };
  const disable = async () => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await disableCurrentPushDevice(memberId); setEnabled(false); setNotice('تم إيقاف تنبيهات هذا الجهاز فقط.'); }
    catch { setError('تعذّر إيقاف التنبيهات. تحقق من الاتصال ثم حاول مرة أخرى.'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (busy || !enabled) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const registration = await navigator.serviceWorker.getRegistration(officeWorkerScope);
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) throw new Error('subscription-unavailable');
      await testOfficePushDevice({ endpoint: subscription.endpoint });
      setNotice('تم إرسال التنبيه التجريبي. إن لم تسمعه، راجع صوت التنبيهات وعدم الإزعاج في الهاتف.');
    } catch (cause) { setError(message(cause, 'تعذّر إرسال التنبيه التجريبي. أعد تفعيل تنبيهات هذا الجهاز.')); }
    finally { setBusy(false); }
  };
  return { supported, needsInstallation, configured: config?.configured ?? false, loading: !config && !error,
    enabled, busy, error, notice, enable, disable, test,
    retry: () => { setError(''); setConfig(null); setCheckVersion(value => value + 1); } };
}
