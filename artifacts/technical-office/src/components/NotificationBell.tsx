import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, Check, Clock3, FileCheck2, RotateCcw, X } from 'lucide-react';
import { Link } from 'wouter';
import {
  getListOfficeNotificationsQueryKey,
  useListOfficeNotifications,
  useMarkOfficeNotificationRead,
} from '@workspace/api-client-react';
import type { OfficeNotification } from '@workspace/api-client-react';

const notificationCopy: Record<OfficeNotification['type'], { label: string; tone: string; icon: typeof Bell }> = {
  task_assigned: { label: 'تكليف جديد', tone: 'assigned', icon: Bell },
  task_returned: { label: 'أُعيدت المهمة', tone: 'returned', icon: RotateCcw },
  task_review: { label: 'بانتظار المراجعة', tone: 'review', icon: FileCheck2 },
  due_soon: { label: 'موعد قريب', tone: 'due', icon: Clock3 },
  overdue: { label: 'متأخرة', tone: 'overdue', icon: AlertCircle },
};

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;

  const difference = timestamp - Date.now();
  const minutes = Math.round(difference / 60_000);
  const formatter = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

export default function NotificationBell() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const queryKey = getListOfficeNotificationsQueryKey();
  const notificationsQuery = useListOfficeNotifications({
    query: {
      queryKey,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    },
  });
  const markRead = useMarkOfficeNotificationRead();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
        setActionError('');
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setActionError('');
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const inbox = notificationsQuery.data;
  const unreadCount = Math.max(0, inbox?.unreadCount ?? 0);
  const notifications = inbox?.notifications ?? [];

  const closeDropdown = () => {
    setIsOpen(false);
    setActionError('');
  };

  const handleMarkRead = (notificationId: number) => {
    setActionError('');
    markRead.mutate(
      { notificationId },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey });
        },
        onError: () => {
          setActionError('تعذّر تحديث حالة الإشعار. تحقق من الاتصال ثم حاول مرة أخرى.');
        },
      },
    );
  };

  return (
    <div ref={containerRef} className="relative z-40" dir="rtl">
      <button
        type="button"
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#e0ded4] bg-[#fbfaf5] text-[#52756d] transition hover:border-[#b8c9be] hover:bg-[#f3f3eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3c7469] focus-visible:ring-offset-2"
        aria-label={unreadCount > 0 ? `الإشعارات، ${unreadCount} غير مقروء` : 'الإشعارات'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="office-notifications-panel"
        onClick={() => {
          setIsOpen((open) => !open);
          setActionError('');
        }}
        data-testid="button-notifications"
      >
        <Bell size={17} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -left-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full border-2 border-[#fbfaf5] bg-[#d97753] px-1 text-[9px] font-extrabold leading-none text-white"
            aria-hidden="true"
            data-testid="badge-notifications-unread"
          >
            {unreadCount > 99 ? '٩٩+' : new Intl.NumberFormat('ar-EG').format(unreadCount)}
          </span>
        )}
      </button>

      {isOpen && (
        <section
          id="office-notifications-panel"
          role="dialog"
          aria-label="الإشعارات"
          className="absolute left-0 top-[calc(100%+12px)] flex max-h-[min(76dvh,610px)] w-[min(92vw,410px)] flex-col overflow-hidden rounded-[18px] border border-[#e2ded2] bg-[#fbfaf5] shadow-[0_18px_55px_rgba(27,49,45,.18)]"
          data-testid="panel-office-notifications"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-[#e8e4d9] bg-[#f5f3eb] px-4 py-3.5 sm:px-5">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-extrabold text-[#294641]">الإشعارات</h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-[#e6eee8] px-2 py-0.5 text-[10px] font-bold text-[#426b5e]">
                    {new Intl.NumberFormat('ar-EG').format(unreadCount)} جديدة
                  </span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-[#87918a]">آخر المستجدات في مهام المكتب</p>
            </div>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg text-[#78857d] transition hover:bg-[#e9e6dc] hover:text-[#294641] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3c7469]"
              onClick={closeDropdown}
              aria-label="إغلاق الإشعارات"
              data-testid="button-close-notifications"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>

          {actionError && (
            <p className="mx-3 mt-3 flex items-start gap-2 rounded-xl border border-[#efd4cc] bg-[#fbefea] px-3 py-2.5 text-xs leading-5 text-[#9d4f40]" role="alert" data-testid="status-notification-action-error">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-live="polite">
            {notificationsQuery.isLoading ? (
              <div className="space-y-3 p-4" role="status" aria-label="جارٍ تحميل الإشعارات" data-testid="status-notifications-loading">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex gap-3 rounded-xl border border-[#eeebe2] p-3">
                    <div className="skeleton h-9 w-9 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-2 pt-1">
                      <div className="skeleton h-3 w-28" />
                      <div className="skeleton h-3 w-full" />
                      <div className="skeleton h-2.5 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notificationsQuery.isError ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center px-5 py-8 text-center" role="alert" data-testid="status-notifications-error">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f7e8e2] text-[#b85d49]">
                  <AlertCircle size={20} aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-bold text-[#304743]">تعذّر تحميل الإشعارات</p>
                <p className="mt-1 max-w-[260px] text-xs leading-5 text-[#78837d]">تحقق من اتصالك ثم أعد المحاولة.</p>
                <button
                  type="button"
                  className="btn btn-soft mt-4 py-2 text-xs"
                  onClick={() => void notificationsQuery.refetch()}
                  disabled={notificationsQuery.isFetching}
                  data-testid="button-retry-notifications"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  {notificationsQuery.isFetching ? 'جارٍ التحديث' : 'إعادة المحاولة'}
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex min-h-[225px] flex-col items-center justify-center px-5 py-8 text-center" data-testid="status-notifications-empty">
                <span className="grid h-12 w-12 place-items-center rounded-2xl border border-[#dfe8e0] bg-[#eaf0e9] text-[#477467]">
                  <Check size={21} aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-bold text-[#304743]">كل شيء هادئ هنا</p>
                <p className="mt-1 max-w-[260px] text-xs leading-6 text-[#78837d]">ستظهر هنا التكليفات ومواعيد التسليم وأي مهمة تحتاج إلى انتباهك.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[#eeebe2]">
                {notifications.map((notification) => {
                  const copy = notificationCopy[notification.type];
                  const Icon = copy.icon;
                  const isUnread = !notification.readAt;
                  const isMarkingThis = markRead.isPending && markRead.variables?.notificationId === notification.id;
                  return (
                    <li
                      key={notification.id}
                      className={`relative px-3 py-3 transition-colors hover:bg-[#f7f5ee] sm:px-4 ${isUnread ? 'bg-[#f7f8f1]' : ''}`}
                      data-testid={`item-notification-${notification.id}`}
                    >
                      {isUnread && <span className="absolute bottom-3 right-0 top-3 w-[3px] rounded-l-full bg-[#d97753]" aria-label="غير مقروء" />}
                      <div className="flex items-start gap-3">
                        <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl notification-icon-${copy.tone}`}>
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`text-[10px] font-bold notification-label-${copy.tone}`}>{copy.label}</span>
                            <time className="text-[10px] text-[#929990]" dateTime={notification.createdAt}>
                              {formatRelativeTime(notification.createdAt)}
                            </time>
                          </div>
                          <Link
                            href={`/projects/${notification.projectId}?taskId=${notification.taskId}`}
                            className="mt-1 block rounded-sm text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3c7469]"
                            onClick={closeDropdown}
                            data-testid={`link-notification-task-${notification.id}`}
                          >
                            <span className="block truncate text-xs font-extrabold leading-5 text-[#304743]">{notification.taskTitle}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[#77847c]">{notification.projectName}</span>
                            <span className="mt-1.5 block break-words text-[11px] leading-[1.7] text-[#65736c]">{notification.message}</span>
                          </Link>
                          <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
                            <Link
                              href={`/projects/${notification.projectId}?taskId=${notification.taskId}`}
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-[#477467] hover:text-[#294641] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3c7469]"
                              onClick={closeDropdown}
                              data-testid={`link-open-notification-${notification.id}`}
                            >
                              افتح المهمة
                              <span aria-hidden="true">←</span>
                            </Link>
                            {isUnread && (
                              <button
                                type="button"
                                className="rounded-md px-2 py-1 text-[10px] font-bold text-[#7b867e] transition hover:bg-[#e9eee7] hover:text-[#365e58] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3c7469] disabled:cursor-wait disabled:opacity-60"
                                onClick={() => handleMarkRead(notification.id)}
                                disabled={markRead.isPending}
                                aria-label={`وضع إشعار ${notification.taskTitle} كمقروء`}
                                data-testid={`button-mark-notification-read-${notification.id}`}
                              >
                                {isMarkingThis ? 'جارٍ الحفظ…' : 'وضع كمقروء'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-between border-t border-[#e8e4d9] bg-[#f7f5ee] px-4 py-2.5 text-[10px] text-[#87918a]">
            <span>تتحدّث القائمة كل دقيقة</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#6d9a7c]" aria-hidden="true" />
              مساحة المكتب
            </span>
          </footer>
        </section>
      )}
      <style>{`
        .notification-icon-assigned { background: #e7efea; color: #477467; }
        .notification-icon-returned { background: #f5e9df; color: #a96846; }
        .notification-icon-review { background: #eee9dd; color: #7c704a; }
        .notification-icon-due { background: #f7eee0; color: #a8793d; }
        .notification-icon-overdue { background: #f7e8e2; color: #b85d49; }
        .notification-label-assigned { color: #477467; }
        .notification-label-returned { color: #a96846; }
        .notification-label-review { color: #7c704a; }
        .notification-label-due { color: #a8793d; }
        .notification-label-overdue { color: #b85d49; }
      `}</style>
    </div>
  );
}
