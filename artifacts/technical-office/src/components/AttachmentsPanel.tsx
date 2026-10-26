import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, CheckCircle2, Download, ExternalLink, FileImage, FileText, LoaderCircle,
  Paperclip, RefreshCw, Trash2, Upload,
} from 'lucide-react';
import {
  getListProjectAttachmentsQueryKey,
  getListTaskAttachmentsQueryKey,
  useGetOfficeDriveStatus,
  useCompleteOfficeAttachmentUpload,
  useDeleteOfficeAttachment,
  useListProjectAttachments,
  useListTaskAttachments,
  useRequestOfficeAttachmentUpload,
  useStartOfficeDriveConnection,
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

function validateAttachmentFile(file: File): string | undefined {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return 'نوع الملف غير مدعوم.';
  }
  if (file.size < 1) {
    return 'الملف فارغ.';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'حجم الملف أكبر من ٥٠ ميجابايت.';
  }
  return undefined;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { data?: { error?: unknown } } | null)?.data?.error;
  return typeof detail === 'string' && /[\u0600-\u06ff]/.test(detail)
    ? detail
    : fallback;
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
  const driveStatusQuery = useGetOfficeDriveStatus();
  const requestUpload = useRequestOfficeAttachmentUpload();
  const completeUpload = useCompleteOfficeAttachmentUpload();
  const deleteAttachment = useDeleteOfficeAttachment();
  const startDriveConnection = useStartOfficeDriveConnection();
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingAttachmentId, setPendingAttachmentId] = useState<number | null>(null);
  const [pendingFileName, setPendingFileName] = useState('');
  const [pendingDriveFileId, setPendingDriveFileId] = useState<string | null>(null);
  const [isPutting, setIsPutting] = useState(false);
  const [isBatchUploading, setIsBatchUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const invalidateList = async () => {
    await queryClient.invalidateQueries({
      queryKey: projectScope
        ? getListProjectAttachmentsQueryKey(projectId)
        : getListTaskAttachmentsQueryKey(taskId),
    });
  };

  const connectDrive = async () => {
    setErrorMessage('');
    try {
      const result = await startDriveConnection.mutateAsync();
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, 'تعذّر بدء ربط درايف. حاول مرة أخرى.'));
    }
  };

  const retryCompletion = async () => {
    if (pendingAttachmentId === null) return;
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await completeUpload.mutateAsync({
        attachmentId: pendingAttachmentId,
        data: pendingDriveFileId ? { fileId: pendingDriveFileId } : {},
      });
      setPendingAttachmentId(null);
      setPendingFileName('');
      setPendingDriveFileId(null);
      await invalidateList();
      setSuccessMessage('تم تأكيد رفع الملف بنجاح.');
    } catch {
      setErrorMessage('تم رفع الملف، لكن تعذّر تأكيده. حاول التأكيد مرة أخرى.');
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selectedFiles = Array.from(input.files ?? []);
    input.value = '';
    if (selectedFiles.length === 0) return;
    setErrorMessage('');
    setSuccessMessage('');

    const validFiles: File[] = [];
    const rejectedFiles: string[] = [];
    for (const file of selectedFiles) {
      const reason = validateAttachmentFile(file);
      if (reason) rejectedFiles.push(`«${file.name}»: ${reason}`);
      else validFiles.push(file);
    }
    if (validFiles.length === 0) {
      setErrorMessage(rejectedFiles.join(' '));
      return;
    }

    setIsBatchUploading(true);
    setUploadProgress({ current: 0, total: validFiles.length });
    let uploadedCount = 0;
    const failedFiles: string[] = [];
    let stoppedMessage = '';
    try {
      for (let index = 0; index < validFiles.length; index += 1) {
        const file = validFiles[index];
        setUploadProgress({ current: index + 1, total: validFiles.length });
        let upload: Awaited<ReturnType<typeof requestUpload.mutateAsync>>;
        try {
          upload = await requestUpload.mutateAsync({
            data: {
              scope: props.scope,
              projectId: projectScope ? props.projectId : null,
              taskId: projectScope ? null : props.taskId,
              fileName: file.name,
              size: file.size,
            },
          });
        } catch (error) {
          stoppedMessage = `تعذّر بدء رفع «${file.name}». ${apiErrorMessage(error, 'تحقق من الاتصال وحاول مرة أخرى.')}`;
          break;
        }

        let putSucceeded = false;
        let driveFileId: string | null = null;
        setIsPutting(true);
        try {
          const response = await fetch(upload.uploadURL, {
            method: 'PUT',
            headers: { 'Content-Type': upload.contentType },
            body: file,
          });
          if (!response.ok) throw new Error('upload-failed');
          if (upload.storageMode === 'google_drive') {
            const result = (await response.json()) as { id?: unknown };
            if (typeof result.id !== 'string' || !result.id) {
              throw new Error('upload-confirmation-missing');
            }
            driveFileId = result.id;
          }
          putSucceeded = true;
        } catch {
          try {
            await deleteAttachment.mutateAsync({ attachmentId: upload.attachmentId });
          } catch {
            // Best-effort cleanup for a failed direct upload.
          }
          failedFiles.push(`تعذّر رفع «${file.name}» إلى مساحة الملفات. تحقق من الاتصال وحاول مرة أخرى.`);
        } finally {
          setIsPutting(false);
        }
        if (!putSucceeded) break;

        setPendingAttachmentId(upload.attachmentId);
        setPendingFileName(file.name);
        setPendingDriveFileId(driveFileId);
        try {
          await completeUpload.mutateAsync({
            attachmentId: upload.attachmentId,
            data: driveFileId ? { fileId: driveFileId } : {},
          });
          setPendingAttachmentId(null);
          setPendingFileName('');
          setPendingDriveFileId(null);
          uploadedCount += 1;
        } catch (error) {
          stoppedMessage = `تم رفع «${file.name}» لكن تعذّر تأكيده. ${apiErrorMessage(error, 'أعد المحاولة دون رفع الملف مرة أخرى.')}`;
          break;
        }
      }

      if (uploadedCount > 0) {
        await invalidateList();
        setSuccessMessage(`تم رفع ${uploadedCount.toLocaleString('ar-EG')} من ${validFiles.length.toLocaleString('ar-EG')} ملفًا بنجاح.`);
      }
      const messages = [...rejectedFiles, ...failedFiles];
      if (stoppedMessage) messages.push(stoppedMessage);
      if (stoppedMessage && uploadedCount + failedFiles.length < validFiles.length) {
        messages.push('تم إيقاف بقية الملفات بعد تعذّر الاتصال.');
      }
      if (messages.length > 0) setErrorMessage(messages.join(' '));
    } finally {
      setUploadProgress(null);
      setIsBatchUploading(false);
    }
  };

  const handleDelete = async (attachment: OfficeAttachment) => {
    if (!attachment.canDelete) return;
    if (!window.confirm(`حذف الملف «${attachment.fileName}» نهائيًا؟`)) return;
    setDeletingId(attachment.id);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await deleteAttachment.mutateAsync({ attachmentId: attachment.id });
      await invalidateList();
    } catch {
      setErrorMessage('تعذّر حذف الملف. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setDeletingId(null);
    }
  };

  const storageNeedsConnection = driveStatusQuery.data?.storageMode === 'google_drive'
    && (!driveStatusQuery.data.configured || !driveStatusQuery.data.connected);
  const storageStatusUnavailable = driveStatusQuery.isPending || driveStatusQuery.isError;
  const busy = requestUpload.isPending || isPutting || completeUpload.isPending || pendingAttachmentId !== null || isBatchUploading || startDriveConnection.isPending;

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
          <label className={`btn btn-primary relative cursor-pointer !px-4 ${busy || storageNeedsConnection || storageStatusUnavailable ? 'pointer-events-none opacity-60' : ''}`} data-testid="label-upload-attachment">
            {busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
            <span>
              {busy
                ? uploadProgress
                  ? `جارٍ رفع ${uploadProgress.current.toLocaleString('ar-EG')} من ${uploadProgress.total.toLocaleString('ar-EG')} ملفات`
                  : 'جارٍ الرفع'
                : driveStatusQuery.isPending ? 'جارٍ فحص التخزين' : 'إرفاق ملفات'}
            </span>
            <input
              type="file"
              className="sr-only"
              aria-label="اختر ملفًا أو عدة ملفات لإرفاقها"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.dwg,.dxf"
              multiple
              disabled={busy || storageNeedsConnection || storageStatusUnavailable}
              onChange={handleFileChange}
              data-testid="input-attachment-file"
            />
          </label>
        )}
      </header>

      <div className="px-4 py-4 sm:px-5" aria-live="polite">
        {driveStatusQuery.isError && (
          <div className="mb-4 rounded-xl border border-[#efd4c9] bg-[#fbefea] px-3 py-3 text-sm leading-6 text-[#a64d40]" role="alert" data-testid="status-storage-unavailable">
            <p>{apiErrorMessage(driveStatusQuery.error, 'تعذّر فحص جاهزية تخزين الملفات. الرفع متوقف لحين نجاح الفحص.')}</p>
            <button type="button" className="btn btn-soft mt-3 !px-3 !py-2 text-xs" onClick={() => void driveStatusQuery.refetch()} disabled={driveStatusQuery.isFetching}>
              إعادة فحص التخزين
            </button>
          </div>
        )}
        {driveStatusQuery.data?.storageMode === 'google_drive' && !driveStatusQuery.data.connected && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ead8bd] bg-[#faf2e4] px-3 py-3 text-sm leading-6 text-[#80643d]" role="status" data-testid="status-drive-connection">
            <span>
              {!driveStatusQuery.data.configured
                ? 'يلزم استكمال إعداد ربط درايف قبل رفع الملفات.'
                : driveStatusQuery.data.isManager
                  ? 'اربط حساب درايف الخاص بالمدير لتفعيل حفظ الملفات.'
                  : 'رفع الملفات متوقف مؤقتًا حتى يربط مدير المكتب حساب درايف.'}
            </span>
            {driveStatusQuery.data.configured && driveStatusQuery.data.isManager && (
              <button
                type="button"
                className="btn btn-soft !px-3 !py-2 text-xs"
                onClick={() => void connectDrive()}
                disabled={startDriveConnection.isPending}
                data-testid="button-connect-office-drive"
              >
                {startDriveConnection.isPending ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <ExternalLink size={14} aria-hidden="true" />}
                ربط حساب درايف
              </button>
            )}
          </div>
        )}
        {errorMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#efd4c9] bg-[#fbefea] px-3 py-3 text-sm leading-6 text-[#a64d40]" role="alert" data-testid="status-attachments-error">
            <AlertCircle size={17} className="mt-1 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#d3e7dc] bg-[#edf6f0] px-3 py-3 text-sm leading-6 text-[#386d60]" role="status" data-testid="status-attachments-success">
            <CheckCircle2 size={17} className="mt-1 shrink-0" aria-hidden="true" />
            <span>{successMessage}</span>
          </div>
        )}

        {pendingAttachmentId !== null && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ead8bd] bg-[#faf2e4] px-3 py-3" data-testid={`status-pending-attachment-${pendingAttachmentId}`}>
            <span className="flex items-center gap-2 text-sm text-[#80643d]">
              <CheckCircle2 size={16} aria-hidden="true" />
              {pendingFileName ? `الملف «${pendingFileName}» مرفوع وينتظر التأكيد.` : 'الملف مرفوع وينتظر التأكيد.'}
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
