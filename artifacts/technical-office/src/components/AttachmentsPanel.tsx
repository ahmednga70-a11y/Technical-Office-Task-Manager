import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, Download, ExternalLink, FileImage, FileText, LoaderCircle,
  Paperclip, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import {
  getListProjectAttachmentsQueryKey,
  getListTaskAttachmentsQueryKey,
  useCompleteOfficeAttachmentUpload,
  useDeleteOfficeAttachment,
  useListProjectAttachments,
  useListTaskAttachments,
  useRequestOfficeAttachmentUpload,
} from '@workspace/api-client-react';
import type { OfficeAttachment } from '@workspace/api-client-react';

type Props =
  | { scope: 'project'; projectId: number; canUpload: boolean }
  | { scope: 'task'; taskId: number; canUpload: boolean };

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'dwg', 'dxf',
]);

function formatSize(size: number) {
  if (size < 1024) return `${size} بايت`;
  if (size < 1024 * 1024) return `${(size / 1024).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} كيلوبايت`;
  return `${(size / (1024 * 1024)).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} ميجابايت`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function isPreviewable(attachment: OfficeAttachment) {
  const extension = attachment.fileName.split('.').pop()?.toLowerCase();
  return attachment.contentType === 'application/pdf'
    || attachment.contentType.startsWith('image/')
    || extension === 'pdf'
    || ['png', 'jpg', 'jpeg', 'webp'].includes(extension || '');
}

export default function AttachmentsPanel(props: Props) {
  const queryClient = useQueryClient();
  const projectScope = props.scope === 'project';
  const projectId = projectScope ? props.projectId : 0;
  const taskId = projectScope ? 0 : props.taskId;
  const projectQuery = useListProjectAttachments(projectId, {
    query: { enabled: projectScope, queryKey: getListProjectAttachmentsQueryKey(projectId) },
  });
  const taskQuery = useListTaskAttachments(taskId, {
    query: { enabled: !projectScope, queryKey: getListTaskAttachmentsQueryKey(taskId) },
  });
  const listQuery = projectScope ? projectQuery : taskQuery;
  const attachments = listQuery.data ?? [];
  const requestUpload = useRequestOfficeAttachmentUpload();
  const completeUpload = useCompleteOfficeAttachmentUpload();
  const deleteAttachment = useDeleteOfficeAttachment();
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingAttachmentId, setPendingAttachmentId] = useState<number | null>(null);
  const [isPutting, setIsPutting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const invalidateList = async () => {
    await queryClient.invalidateQueries({
      queryKey: projectScope
        ? getListProjectAttachmentsQueryKey(projectId)
        : getListTaskAttachmentsQueryKey(taskId),
    });
  };

  const retryCompletion = async () => {
    if (pendingAttachmentId === null) return;
    setErrorMessage('');
    try {
      await completeUpload.mutateAsync({ attachmentId: pendingAttachmentId });
      setPendingAttachmentId(null);
      await invalidateList();
    } catch {
      setErrorMessage('تم رفع الملف، لكن تعذّر تأكيده. حاول التأكيد مرة أخرى.');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setErrorMessage('');

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      setErrorMessage('نوع الملف غير مدعوم. اختر ملفاً بالامتدادات المسموح بها.');
      return;
    }
    if (file.size < 1) {
      setErrorMessage('الملف فارغ، اختر ملفاً يحتوي على بيانات.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setErrorMessage('حجم الملف أكبر من الحد المسموح؛ الحد الأقصى ٥٠ ميجابايت.');
      return;
    }

    try {
      const upload = await requestUpload.mutateAsync({
        data: {
          scope: props.scope,
          projectId: projectScope ? props.projectId : null,
          taskId: projectScope ? null : props.taskId,
          fileName: file.name,
          size: file.size,
        },
      });
      setIsPutting(true);
      let putSucceeded = false;
      try {
        const response = await fetch(upload.uploadURL, {
          method: 'PUT',
          headers: { 'Content-Type': upload.contentType },
          body: file,
        });
        if (!response.ok) throw new Error('upload-failed');
        putSucceeded = true;
      } catch {
        try {
          await deleteAttachment.mutateAsync({ attachmentId: upload.attachmentId });
        } catch {
          // Best-effort cleanup for a failed direct upload.
        }
        setErrorMessage('تعذّر رفع الملف إلى التخزين. تحقق من الاتصال وحاول مرة أخرى.');
      } finally {
        setIsPutting(false);
      }

      if (!putSucceeded) return;
      setPendingAttachmentId(upload.attachmentId);
      try {
        await completeUpload.mutateAsync({ attachmentId: upload.attachmentId });
        setPendingAttachmentId(null);
        await invalidateList();
      } catch {
        setErrorMessage('تم رفع الملف، لكن تعذّر تأكيده. يمكنك إعادة المحاولة دون رفع الملف مرة أخرى.');
      }
    } catch {
      setErrorMessage('تعذّر الاتصال بالخدمة لبدء رفع الملف. حاول مرة أخرى.');
    }
  };

  const handleDelete = async (attachment: OfficeAttachment) => {
    if (!attachment.canDelete) return;
    if (!window.confirm(`حذف الملف «${attachment.fileName}» نهائيًا؟`)) return;
    setDeletingId(attachment.id);
    setErrorMessage('');
    try {
      await deleteAttachment.mutateAsync({ attachmentId: attachment.id });
      await invalidateList();
    } catch {
      setErrorMessage('تعذّر حذف الملف. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setDeletingId(null);
    }
  };

  const busy = requestUpload.isPending || isPutting || completeUpload.isPending || pendingAttachmentId !== null;

  return (
    <section className="panel overflow-hidden" dir="rtl" aria-labelledby="attachments-panel-title" data-testid="panel-attachments">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7e3d8] bg-[#f7f5ee] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#e5efea] text-[#39736a]">
            <Paperclip size={18} aria-hidden="true" />
          </span>
          <div>
            <h2 id="attachments-panel-title" className="font-bold text-[#304743]" data-testid="text-attachments-title">ملفات {projectScope ? 'المشروع' : 'المهمة'}</h2>
            <p className="mt-1 text-xs text-[#87918b]" data-testid="text-attachments-count">{attachments.length.toLocaleString('ar-EG')} ملف</p>
          </div>
        </div>
        {props.canUpload && (
          <label className={`btn btn-primary relative cursor-pointer !px-4 ${busy ? 'pointer-events-none opacity-60' : ''}`} data-testid="label-upload-attachment">
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
            <span>{busy ? 'جارٍ الرفع' : 'إرفاق ملف'}</span>
            <input
              type="file"
              className="sr-only"
              aria-label="اختر ملفاً لإرفاقه"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.dwg,.dxf"
              disabled={busy}
              onChange={handleFileChange}
              data-testid="input-attachment-file"
            />
          </label>
        )}
      </header>

      <div className="px-4 py-4 sm:px-5" aria-live="polite">
        {errorMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#efd4c9] bg-[#fbefea] px-3 py-3 text-sm leading-6 text-[#a64d40]" role="alert" data-testid="status-attachments-error">
            <AlertCircle size={17} className="mt-1 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
        )}

        {pendingAttachmentId !== null && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ead8bd] bg-[#faf2e4] px-3 py-3" data-testid={`status-pending-attachment-${pendingAttachmentId}`}>
            <span className="flex items-center gap-2 text-sm text-[#80643d]">
              <CheckCircle2 size={16} aria-hidden="true" />
              الملف مرفوع وينتظر التأكيد.
            </span>
            <button
              type="button"
              className="btn btn-soft !px-3 !py-2 text-xs"
              onClick={retryCompletion}
              disabled={completeUpload.isPending}
              data-testid="button-retry-attachment-completion"
            >
              <RefreshCw size={14} className={completeUpload.isPending ? 'animate-spin' : ''} aria-hidden="true" />
              إعادة التأكيد
            </button>
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="space-y-3 py-1" role="status" aria-label="جارٍ تحميل الملفات" data-testid="status-attachments-loading">
            {[0, 1, 2].map((item) => (
              <div className="flex items-center gap-3 rounded-xl border border-[#efede5] p-3" key={item}>
                <div className="skeleton h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1"><div className="skeleton mb-2 h-3 w-1/2" /><div className="skeleton h-2.5 w-1/3" /></div>
              </div>
            ))}
          </div>
        ) : listQuery.isError ? (
          <div className="flex flex-col items-center py-8 text-center" role="alert" data-testid="status-attachments-load-error">
            <AlertCircle size={22} className="text-[#bd6751]" aria-hidden="true" />
            <p className="mt-3 text-sm font-bold text-[#435750]">تعذّر تحميل الملفات</p>
            <p className="mt-1 text-xs text-[#87918b]">تحقق من اتصالك وحاول مرة أخرى.</p>
            <button type="button" className="btn btn-soft mt-4" onClick={() => void listQuery.refetch()} data-testid="button-retry-attachments-list">
              <RefreshCw size={14} aria-hidden="true" /> إعادة المحاولة
            </button>
          </div>
        ) : attachments.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center" data-testid="status-attachments-empty">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#f0eee4] text-[#8a805f]"><FileText size={21} aria-hidden="true" /></span>
            <p className="mt-3 text-sm font-bold text-[#435750]">لا توجد ملفات مرفقة بعد</p>
            <p className="mt-1 text-xs leading-6 text-[#87918b]">{props.canUpload ? 'أرفق الرسومات والمستندات المهمة لتكون في متناول الفريق.' : 'ستظهر الملفات هنا عند إضافتها.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#eeece4]" data-testid="list-attachments">
            {attachments.map((attachment) => {
              const contentUrl = `/api/office/attachments/${attachment.id}/content`;
              const previewable = isPreviewable(attachment);
              return (
                <li key={attachment.id} className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center" data-testid={`row-attachment-${attachment.id}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${previewable ? 'bg-[#e7efeb] text-[#39736a]' : 'bg-[#f3e9df] text-[#a86c48]'}`}>
                    {previewable && attachment.contentType.startsWith('image/') ? <FileImage size={18} aria-hidden="true" /> : <FileText size={18} aria-hidden="true" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold leading-6 text-[#304743]" data-testid={`text-attachment-name-${attachment.id}`}>{attachment.fileName}</p>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-[#87918b]" data-testid={`text-attachment-meta-${attachment.id}`}>
                      <span>{attachment.uploadedByName}</span><span aria-hidden="true">·</span>
                      <time dateTime={attachment.createdAt}>{formatDate(attachment.createdAt)}</time><span aria-hidden="true">·</span>
                      <span>{formatSize(attachment.size)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {previewable && (
                      <a
                        href={contentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost !px-3 !py-2 text-xs"
                        aria-label={`معاينة ${attachment.fileName}`}
                        data-testid={`link-preview-attachment-${attachment.id}`}
                      >
                        <ExternalLink size={14} aria-hidden="true" /> معاينة
                      </a>
                    )}
                    <a
                      href={contentUrl}
                      download={attachment.fileName}
                      className="btn btn-ghost !px-3 !py-2 text-xs"
                      aria-label={`تنزيل ${attachment.fileName}`}
                      data-testid={`link-download-attachment-${attachment.id}`}
                    >
                      <Download size={14} aria-hidden="true" /> تنزيل
                    </a>
                    {attachment.canDelete && (
                      <button
                        type="button"
                        className="btn btn-ghost !px-2 !py-2 text-[#a64d40] hover:bg-[#f8e9e4]"
                        aria-label={`حذف ${attachment.fileName}`}
                        title="حذف الملف"
                        disabled={deletingId === attachment.id}
                        onClick={() => void handleDelete(attachment)}
                        data-testid={`button-delete-attachment-${attachment.id}`}
                      >
                        {deletingId === attachment.id ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 border-t border-[#efede5] pt-3 text-[10px] leading-5 text-[#929990]" data-testid="text-attachment-limit">
          الملفات المسموح بها: PDF، صور، مستندات وجداول وعروض، وملفات DWG أو DXF. الحد الأقصى للملف ٥٠ ميجابايت.
        </p>
      </div>
    </section>
  );
}
