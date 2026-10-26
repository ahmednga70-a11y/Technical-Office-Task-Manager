import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficeNotification } from '@workspace/api-client-react';

function playChime(context: AudioContext) {
  const start = context.currentTime;
  [740, 988].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.16;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.27);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

export function useNotificationSound(memberId: number | undefined, notifications: OfficeNotification[] | undefined, phonePushEnabled = false) {
  const preferenceKey = `office-notification-sound:${memberId ?? 'pending'}`;
  const [enabled, setEnabled] = useState(() => {
    try { return Boolean(memberId) && localStorage.getItem(preferenceKey) === 'on'; }
    catch { return false; }
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const contextRef = useRef<AudioContext | null>(null);
  const highestSeenId = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    const AudioConstructor = window.AudioContext
      ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioConstructor) throw new Error('unsupported-audio');
    if (!contextRef.current || contextRef.current.state === 'closed') {
      contextRef.current = new AudioConstructor();
      contextRef.current.onstatechange = () => {
        setReady(contextRef.current?.state === 'running');
      };
    }
    await contextRef.current.resume();
    if (contextRef.current.state !== 'running') throw new Error('audio-blocked');
    setReady(true);
    return contextRef.current;
  }, []);

  const enable = async () => {
    try {
      const context = await unlock();
      setEnabled(true);
      setError('');
      try { localStorage.setItem(preferenceKey, 'on'); } catch { /* Session-only preference. */ }
      playChime(context);
    } catch {
      setReady(false);
      setError('تعذّر تشغيل الصوت. تأكد من صوت الجهاز واضغط تفعيل الصوت مرة أخرى.');
    }
  };

  const toggle = () => {
    if (!enabled || !ready) { void enable(); return; }
    setEnabled(false);
    setReady(false);
    setError('');
    try { localStorage.setItem(preferenceKey, 'off'); } catch { /* Session-only preference. */ }
    void contextRef.current?.suspend().catch(() => {});
  };

  useEffect(() => {
    if (!enabled || ready) return;
    // A stored preference cannot bypass browser autoplay rules. Unlock after
    // a real user gesture, without replaying previously loaded notifications.
    const activate = () => { void unlock().catch(() => {}); };
    window.addEventListener('pointerdown', activate);
    window.addEventListener('keydown', activate);
    return () => {
      window.removeEventListener('pointerdown', activate);
      window.removeEventListener('keydown', activate);
    };
  }, [enabled, ready, unlock]);

  useEffect(() => {
    if (!notifications) return;
    const maxId = Math.max(0, ...notifications.map(item => item.id));
    const previous = highestSeenId.current;
    highestSeenId.current = Math.max(previous ?? 0, maxId);
    // Initial data is a baseline, not a new delivery. Read/unread updates and
    // repeated polling must never replay a notification's sound.
    if (previous === null || phonePushEnabled || !enabled || !ready || contextRef.current?.state !== 'running') return;
    if (notifications.some(item => item.id > previous && !item.readAt)) {
      playChime(contextRef.current);
    }
  }, [notifications, enabled, ready, phonePushEnabled]);

  useEffect(() => () => {
    const context = contextRef.current;
    contextRef.current = null;
    if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
  }, []);

  return { enabled, ready, error, toggle };
}
