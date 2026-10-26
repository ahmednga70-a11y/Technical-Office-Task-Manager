import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Circle, LoaderCircle, MessageCircle, Pencil, Play, Send, Trash2 } from 'lucide-react';
import {
  getGetOfficeDashboardQueryKey, getGetProjectQueryKey, getGetTaskDiscussionQueryKey,
  getListOfficeNotificationsQueryKey, getListProjectsQueryKey, getListTasksQueryKey,
  useUpdateTask,
  type Task,
} from '@workspace/api-client-react';

type Props = {
  task: Task;
  memberId?: number;
  canManage: boolean;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onDiscussion?: (task: Task) => void;
};

export default function TaskActions({ task, memberId, canManage, onEdit, onDelete, onDiscussion }: Props) {
  const client = useQueryClient();
  const update = useUpdateTask();
  const [requestedStatus, setRequestedStatus] = useState<Task['status'] | null>(null);
  const canUpdate = canManage || task.assigneeId === memberId;
  if (!memberId || !canUpdate) return null;
  const isAssignedEngineer = !canManage && task.assigneeId === memberId;
  const choices = [
    { status: 'todo', label: 'لم تبدأ', icon: Circle },
    {
      status: 'in_progress',
      label: task.status === 'review' || task.status === 'done'
        ? 'إرجاع للتنفيذ' : isAssignedEngineer ? 'بدأت التنفيذ' : 'بدء التنفيذ',
      icon: Play,
    },
    { status: 'review', label: isAssignedEngineer ? 'خلصت وبعت للمراجعة' : 'إرسال للمراجعة', icon: Send },
    { status: 'done', label: canManage ? 'اعتماد الإنجاز' : 'تحديد كمكتملة', icon: CheckCheck },
  ] as const;

  const changeStatus = (status: Task['status']) => {
    if (update.isPending || status === task.status) return;
    setRequestedStatus(status);
    update.mutate({ taskId: task.id, data: { status } }, {
      onSuccess: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: getListTasksQueryKey() }),
          client.invalidateQueries({ queryKey: getGetProjectQueryKey(task.projectId) }),
          client.invalidateQueries({ queryKey: getListProjectsQueryKey() }),
          client.invalidateQueries({ queryKey: getGetOfficeDashboardQueryKey() }),
          client.invalidateQueries({ queryKey: getGetTaskDiscussionQueryKey(task.id) }),
          client.invalidateQueries({ queryKey: getListOfficeNotificationsQueryKey() }),
        ]);
      },
    });
  };

  return (
    <div className="col-span-full min-w-0 rounded-2xl border border-[#e7e9df] bg-[#f8f9f4] p-3" data-testid={`task-actions-${task.id}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-[#536a60]">تحديث حالة المهمة</span>
        {update.isPending && <span className="text-xs text-[#536a60]" role="status">جارٍ حفظ الحالة…</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap" role="group" aria-label={`تحديث حالة المهمة ${task.title}`}>
        {choices.map(({ status, label, icon: Icon }) => {
          const selected = task.status === status;
          return (
            <button type="button" key={status} onClick={() => changeStatus(status)}
              disabled={selected || update.isPending} aria-pressed={selected}
              aria-label={`${label} — ${task.title}`}
              className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold leading-5 transition-colors md:justify-start ${
                selected ? 'border-[#2a625c] bg-[#2a625c] text-white'
                  : 'border-[#d9e0d7] bg-white text-[#365951] hover:border-[#7a9c8d] hover:bg-[#edf3ed] disabled:opacity-60'
              }`}
              data-testid={`button-task-status-${task.id}-${status}`}>
              {update.isPending && requestedStatus === status
                ? <LoaderCircle size={15} className="shrink-0 animate-spin" />
                : <Icon size={15} className="shrink-0" />}
              <span>{label}</span>
              {selected && <span className="sr-only">الحالة الحالية</span>}
            </button>
          );
        })}
      </div>
      {update.isError && (
        <p role="alert" className="mt-2 rounded-lg bg-[#fbefea] px-3 py-2 text-xs leading-5 text-[#a04d3d]">
          تعذّر تأكيد حفظ الحالة. تحقق من الاتصال وأعد تحميل المهمة قبل المحاولة مرة أخرى.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 border-t border-[#e2e7dc] pt-3" role="group" aria-label={`إجراءات المهمة ${task.title}`}>
        {onDiscussion && (
          <button type="button" onClick={() => onDiscussion(task)} disabled={update.isPending}
            className="btn btn-soft min-h-11 !px-3 !py-2 !text-xs disabled:opacity-60" data-testid={`button-discussion-task-${task.id}`}>
            <MessageCircle size={15} className="shrink-0" />النقاش والسجل والملفات
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={() => onEdit(task)} disabled={update.isPending}
            className="btn btn-soft min-h-11 !px-3 !py-2 !text-xs disabled:opacity-60" data-testid={`button-edit-task-${task.id}`}>
            <Pencil size={15} className="shrink-0" />تعديل بيانات المهمة
          </button>
        )}
        {onDelete && canManage && (
          <button type="button" onClick={() => onDelete(task)} disabled={update.isPending}
            className="btn min-h-11 !border-[#ecd7cf] !bg-[#fbf0eb] !px-3 !py-2 !text-xs !text-[#a45440] hover:!bg-[#f7e3dc] disabled:opacity-60" data-testid={`button-delete-task-${task.id}`}>
            <Trash2 size={15} className="shrink-0" />حذف المهمة
          </button>
        )}
      </div>
    </div>
  );
}
