import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, Check, Clock3, MessageCircle, RefreshCw, Send, UserRound, X } from 'lucide-react';
import {
  getGetTaskDiscussionQueryKey,
  useCreateTaskComment,
  useGetTaskDiscussion,
} from '@workspace/api-client-react';
import type { Task, TaskActivity, TaskComment } from '@workspace/api-client-react';
import AttachmentsPanel from '@/components/AttachmentsPanel';

const MAX_COMMENT_LENGTH = 4000;

const statusLabels: Record<string, string> = {
  todo: 'لم تبدأ',
  in_progress: 'قيد التنفيذ',
  review: 'مراجعة',
  done: 'مكتملة',
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDateValue(value: string | null) {
  if (!value) return 'بدون موعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function eventDescription(activity: TaskActivity) {
  switch (activity.eventType) {
    case 'created':
      return 'أنشأ هذه المهمة';
    case 'status_changed':
      return (
        <>
          غيّر الحالة من <strong>{statusLabels[activity.oldValue || ''] || activity.oldValue || 'غير محددة'}</strong>
          {' '}إلى <strong>{statusLabels[activity.newValue || ''] || activity.newValue || 'غير محددة'}</strong>
        </>
      );
    case 'due_date_changed':
      return (
        <>
          حدّث موعد التسليم من <strong>{formatDateValue(activity.oldValue)}</strong>
          {' '}إلى <strong>{formatDateValue(activity.newValue)}</strong>
        </>
      );
    case 'assignee_changed':
      return (
        <>
          غيّر المسؤول من <strong>{activity.oldValue || 'غير معيّنة'}</strong>
          {' '}إلى <strong>{activity.newValue || 'غير معيّنة'}</strong>
        </>
      );
    default:
      return 'سجّل تحديثاً على المهمة';
  }
}

type ThreadEntry =
  | { kind: 'comment'; id: string; createdAt: string; value: TaskComment }
  | { kind: 'activity'; id: string; createdAt: string; value: TaskActivity };

export interface TaskDiscussionDialogProps {
  task: Task;
  canUpload: boolean;
  onClose: () => void;
}

export default function TaskDiscussionDialog({ task, canUpload, onClose }: TaskDiscussionDialogProps) {
  const queryClient = useQueryClient();
  const discussionQuery = useGetTaskDiscussion(task.id, {
    query: { queryKey: getGetTaskDiscussionQueryKey(task.id) },
  });
  const createComment = useCreateTaskComment();
  const [body, setBody] = useState('');
  const [validationMessage, setValidationMessage] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !createComment.isPending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createComment.isPending, onClose]);

  const thread = useMemo<ThreadEntry[]>(() => {
    const comments = discussionQuery.data?.comments ?? [];
    const activities = discussionQuery.data?.activities ?? [];
    return [
      ...comments.map((value) => ({ kind: 'comment' as const, id: `comment-${value.id}`, createdAt: value.createdAt, value })),
      ...activities.map((value) => ({ kind: 'activity' as const, id: `activity-${value.id}`, createdAt: value.createdAt, value })),
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [discussionQuery.data]);

  const submitComment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setValidationMessage('اكتب تعليقاً قبل الإرسال.');
      return;
    }
    setValidationMessage('');
    createComment.mutate(
      { taskId: task.id, data: { body: trimmedBody } },
      {
        onSuccess: () => {
          setBody('');
          void queryClient.invalidateQueries({ queryKey: getGetTaskDiscussionQueryKey(task.id) });
        },
      },
    );
  };

  const hasThread = thread.length > 0;

  return (
    <div
      className="modal-backdrop"
      dir="rtl"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !createComment.isPending) onClose();
      }}
    >
      <section
        className="flex max-h-[min(90dvh,850px)] w-full max-w-[680px] flex-col overflow-hidden rounded-[20px] border border-[#dedbd0] bg-[#fbfaf5] shadow-[0_24px_80px_rgba(15,37,36,.2)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-discussion-title"
        aria-describedby="task-discussion-subtitle"
        data-testid="dialog-task-discussion"
      >
        <header className="shrink-0 border-b border-[#e7e3d8] bg-[#f5f3eb] px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[.08em] text-[#d77850]">
                <MessageCircle size={14} aria-hidden="true" />
                نقاش وسجل المهمة
              </p>
              <h2 id="task-discussion-title" className="truncate text-xl font-extrabold leading-8 text-[#203b39] sm:text-2xl">
                {task.title}
              </h2>
              <p id="task-discussion-subtitle" className="mt-1 text-xs text-[#78837d]">
                {task.projectName} <span className="mx-1 text-[#c4bfb1]">/</span> كل القرارات والتعليقات في مكان واحد
              </p>
            </div>
            <button
              type="button"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#e1ddd1] bg-[#fbfaf5] text-[#6d7a73] transition hover:bg-white hover:text-[#203b39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3c7469]"
              onClick={onClose}
              aria-label="إغلاق النقاش"
              title="إغلاق"
              data-testid="button-close-task-discussion"
            >
              <X size={18} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-[#718078]">
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={13} className="text-[#4b766b]" aria-hidden="true" />
              {task.assigneeName || 'غير معيّنة'}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={13} className="text-[#c8754e]" aria-hidden="true" />
              التسليم {formatDateValue(task.dueDate)}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7" aria-live="polite">
          <div className="mb-5">
            <AttachmentsPanel scope="task" taskId={task.id} canUpload={canUpload} />
          </div>
          {discussionQuery.isLoading ? (
            <div className="space-y-5 py-2" aria-label="جارٍ تحميل النقاش" role="status">
              {[0, 1, 2].map((item) => (
                <div className="flex gap-3" key={item}>
                  <div className="skeleton h-9 w-9 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="skeleton mb-2 h-3 w-28" />
                    <div className="skeleton h-16 w-full max-w-md" />
                  </div>
                </div>
              ))}
            </div>
          ) : discussionQuery.isError ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-4 text-center" role="alert">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f7e8e2] text-[#b85d49]">
                <AlertCircle size={22} />
              </span>
              <h3 className="mt-4 font-bold text-[#304743]">تعذّر تحميل سجل المهمة</h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-[#78837d]">تحقق من الاتصال ثم حاول تحميل النقاش مرة أخرى.</p>
              <button
                type="button"
                className="btn btn-soft mt-4"
                onClick={() => void discussionQuery.refetch()}
                disabled={discussionQuery.isFetching}
                data-testid="button-retry-task-discussion"
              >
                <RefreshCw size={15} className={discussionQuery.isFetching ? 'animate-spin' : ''} />
                إعادة المحاولة
              </button>
            </div>
          ) : hasThread ? (
            <ol className="relative space-y-5 before:absolute before:bottom-4 before:right-[17px] before:top-4 before:w-px before:bg-[#e6e2d7]">
              {thread.map((entry) => {
                if (entry.kind === 'activity') {
                  return (
                    <li key={entry.id} className="relative flex gap-3">
                      <span className="z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#d7e4de] bg-[#e8efea] text-[#477467]">
                        {entry.value.eventType === 'due_date_changed' ? <CalendarDays size={15} /> : entry.value.eventType === 'assignee_changed' ? <UserRound size={15} /> : entry.value.eventType === 'created' ? <Check size={15} /> : <Clock3 size={15} />}
                      </span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-xs font-bold text-[#36534c]">{entry.value.actorName || 'عضو الفريق'}</span>
                          <time className="text-[10px] text-[#929990]" dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
                        </div>
                        <p className="mt-1 text-xs leading-6 text-[#66756e]">{eventDescription(entry.value)}</p>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={entry.id} className="relative flex gap-3">
                    <span className="z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#eed7c9] bg-[#f7e9df] text-[11px] font-extrabold text-[#a96045]">
                      {(entry.value.authorName || 'م').trim().slice(0, 1)}
                    </span>
                    <article className="min-w-0 flex-1 rounded-2xl border border-[#e9e4d9] bg-white/75 px-4 py-3 shadow-[0_2px_8px_rgba(40,56,51,.025)]">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-xs font-bold text-[#36534c]">{entry.value.authorName || 'عضو الفريق'}</span>
                        <time className="text-[10px] text-[#929990]" dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-[#4d5e57]">{entry.value.body}</p>
                    </article>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="flex min-h-[230px] flex-col items-center justify-center px-4 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[#dfe8e0] bg-[#eaf0e9] text-[#477467]">
                <MessageCircle size={23} />
              </span>
              <h3 className="mt-4 font-bold text-[#304743]">بداية سجل واضح للمهمة</h3>
              <p className="mt-2 max-w-sm text-sm leading-7 text-[#78837d]">
                لا توجد تعليقات أو تحديثات حتى الآن. أضف ملاحظة لتوثيق قرار أو ترك تفاصيل للفريق.
              </p>
            </div>
          )}
        </div>

        <form onSubmit={submitComment} className="shrink-0 border-t border-[#e7e3d8] bg-[#f7f5ee] px-5 py-4 sm:px-7">
          <label htmlFor="task-discussion-comment" className="field-label">أضف تعليقاً</label>
          <textarea
            id="task-discussion-comment"
            className="field min-h-[86px] resize-y bg-[#fffefa] text-sm leading-6"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              if (validationMessage) setValidationMessage('');
            }}
            maxLength={MAX_COMMENT_LENGTH}
            placeholder="اكتب ملاحظة أو قراراً يحتاج الفريق إلى الرجوع إليه..."
            aria-describedby="task-comment-hint task-comment-count"
            aria-invalid={Boolean(validationMessage || createComment.isError)}
            disabled={createComment.isPending}
            data-testid="input-task-comment"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span id="task-comment-hint" className="min-h-4 text-xs text-[#b45543]" role="status">
              {validationMessage || (createComment.isError ? 'لم يتم إرسال التعليق. احتفظنا بنصك، حاول مرة أخرى.' : '')}
            </span>
            <span id="task-comment-count" className="font-mono text-[10px] text-[#929990]" dir="ltr">
              {body.length.toLocaleString('en-US')} / {MAX_COMMENT_LENGTH.toLocaleString('en-US')}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="hidden text-[10px] text-[#929990] sm:inline">تظهر التعليقات بترتيب وقتها مع سجل التغييرات</span>
            <button
              type="submit"
              className="btn btn-primary min-w-[126px] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={createComment.isPending || !body.trim()}
              data-testid="button-post-task-comment"
            >
              {createComment.isPending ? <><RefreshCw size={15} className="animate-spin" /> جارٍ الإرسال</> : <><Send size={15} /> أرسل التعليق</>}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
