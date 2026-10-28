import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ChevronDown, Download, ExternalLink, FileText, FolderKanban, LoaderCircle, Lock, RefreshCw, Search } from 'lucide-react';
import { getGetOfficeSharedReportQueryKey, useGetOfficeSharedReport } from '@workspace/api-client-react';
import type { OfficeAttachment, Task } from '@workspace/api-client-react';

const statusLabel: Record<string, string> = { todo: 'لم تبدأ', in_progress: 'قيد التنفيذ', review: 'مراجعة', done: 'مكتملة' };
const statusTone: Record<string, string> = {
  todo: 'bg-[#f1eee5] text-[#696b5e]', in_progress: 'bg-[#e0efec] text-[#286960]',
  review: 'bg-[#fbeddc] text-[#9d6029]', done: 'bg-[#e6f1e2] text-[#4c7446]',
};
const statusColor: Record<string, string> = { done: '#7aa36d', review: '#d99a5b', in_progress: '#3f8578', todo: '#cfcabb' };
const fmtDate = (v?: string | null, time = false) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('ar-EG', time ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};
const sizeLabel = (n: number) => n < 1024 * 1024 ? `${(n / 1024).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} كيلوبايت` : `${(n / 1048576).toLocaleString('ar-EG', { maximumFractionDigits: 1 })} ميجابايت`;

function readToken() {
  const raw = window.location.hash.replace(/^#/, '').trim();
  return /^[a-f0-9]{64}$/.test(raw) ? raw : '';
}

function setMeta() {
  const set = (name: string, content: string) => {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
    const prev = el.content; el.content = content; return () => { el!.content = prev; };
  };
  const a = set('robots', 'noindex, nofollow, noarchive');
  const b = set('referrer', 'no-referrer');
  const prevTitle = document.title; document.title = 'متابعة المشاريع — فريق المكتب الفنى';
  return () => { a(); b(); document.title = prevTitle; };
}

function FileRow({ file, token, label }: { file: OfficeAttachment; token: string; label?: string }) {
  const [busy, setBusy] = useState<'' | 'open' | 'save'>('');
  const [err, setErr] = useState('');
  const get = async (mode: 'open' | 'save') => {
    setBusy(mode); setErr('');
    const win = mode === 'open' ? window.open('', '_blank') : null;
    try {
      const res = await fetch(`/api/office/shared/files/${file.id}`, { headers: { 'X-Office-Share': token }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? 'gone' : 'fail');
      const url = URL.createObjectURL(await res.blob());
      if (win) { win.opener = null; win.location.href = url; }
      else { const a = document.createElement('a'); a.href = url; a.download = file.fileName; a.rel = 'noreferrer'; document.body.appendChild(a); a.click(); a.remove(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      win?.close();
      setErr((e as Error).message === 'gone' ? 'الملف لم يعد متاحًا أو أُلغي الرابط.' : 'تعذّر جلب الملف. حاول مرة أخرى.');
    } finally { setBusy(''); }
  };
  return <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e7efeb] text-[#39736a]"><FileText size={16} /></span>
    <div className="min-w-0 flex-1">
      {label && <p className="text-[10px] font-bold text-[#d77850]">{label}</p>}
      <p className="break-words text-[13px] font-bold text-[#304743] [overflow-wrap:anywhere]">{file.fileName}</p>
      <p className="mt-0.5 text-[11px] text-[#87918b]">{file.uploadedByName} · {fmtDate(file.createdAt)} · {sizeLabel(file.size)}</p>
      {err && <p className="mt-1 text-[11px] text-[#a64d40]" role="alert">{err}</p>}
    </div>
    <div className="flex shrink-0 gap-1">
      <button className="btn btn-ghost !px-3 !py-2 text-xs" disabled={!!busy} onClick={() => void get('open')}>{busy === 'open' ? <LoaderCircle size={14} className="animate-spin" /> : <ExternalLink size={14} />} فتح</button>
      <button className="btn btn-ghost !px-3 !py-2 text-xs" disabled={!!busy} onClick={() => void get('save')}>{busy === 'save' ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />} تنزيل</button>
    </div>
  </li>;
}

function SharedTask({ task, files, token }: { task: Task; files: OfficeAttachment[]; token: string }) {
  const late = task.status !== 'done' && new Date(task.dueDate) < new Date();
  return <details className="task-list-row" data-testid={`row-shared-task-${task.id}`}>
    <summary className="task-list-summary">
      <span className="task-list-bullet" style={{ background: statusColor[task.status] }} aria-hidden="true" />
      <span className="task-list-copy">
        <span className="task-list-title">{task.title}</span>
        <span className="task-list-project">{task.projectName}</span>
        <span className="task-list-assignee">{task.assigneeName || 'غير معيّنة'}</span>
      </span>
      <ChevronDown className="task-list-chevron" size={16} aria-hidden="true" />
    </summary>
    <div className="task-list-details">
      <dl className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
        <div><dt className="mb-2 text-[#839089]">الحالة</dt><dd><span className={`badge ${statusTone[task.status] ?? ''}`}>{statusLabel[task.status] ?? task.status}</span></dd></div>
        <div><dt className="mb-2 text-[#839089]">موعد التسليم</dt><dd className={late ? 'font-bold text-[#bd5d49]' : 'text-[#4d625b]'}>{fmtDate(task.dueDate)}{late && ' — متأخرة'}</dd></div>
        <div><dt className="mb-2 text-[#839089]">المسؤول</dt><dd className="text-[#4d625b]">{task.assigneeName || 'غير معيّنة'}</dd></div>
      </dl>
      <p className="my-4 whitespace-pre-wrap break-words text-sm leading-7 text-[#4d625b]">{task.description || 'لا يوجد وصف إضافي لهذه المهمة.'}</p>
      <h4 className="text-xs font-bold text-[#839089]">ملفات المهمة ({files.length.toLocaleString('ar-EG')})</h4>
      {files.length ? <ul className="divide-y divide-[#e6e3d9]">{files.map((f) => <FileRow key={f.id} file={f} token={token} />)}</ul> : <p className="mt-2 text-xs text-[#87918b]">لا توجد ملفات مرفقة.</p>}
    </div>
  </details>;
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="min-h-[100dvh] overflow-x-hidden bg-[#f7f5ed] landing-grid" dir="rtl">
    <header className="mx-auto flex max-w-[1100px] items-center justify-between gap-3 px-4 py-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-3"><span className="brand-mark shrink-0"><FolderKanban size={20} /></span><span className="truncate text-[15px] font-extrabold text-[#203b39]">فريق المكتب الفنى</span></div>
      <span className="badge shrink-0 bg-[#203b39] text-[#f5f1e5]"><Lock size={12} /> قراءة فقط</span>
    </header>
    <div className="mx-auto max-w-[1100px] px-4 pb-16 sm:px-8">{children}</div>
  </main>;
}

function Notice({ title, body, retry }: { title: string; body: string; retry?: () => void }) {
  return <div className="panel mt-10 flex flex-col items-center px-6 py-14 text-center" role="alert">
    <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#f8e9df] text-[#b35b3d]"><AlertCircle size={24} /></span>
    <h1 className="mt-5 text-lg font-extrabold text-[#304743]">{title}</h1>
    <p className="mt-2 max-w-sm text-sm leading-7 text-[#78837d]">{body}</p>
    {retry && <button className="btn btn-soft mt-5" onClick={retry}><RefreshCw size={15} /> إعادة المحاولة</button>}
  </div>;
}

function Report({ token }: { token: string }) {
  const client = useQueryClient();
  const [revoked, setRevoked] = useState(false);
  const queryKey = getGetOfficeSharedReportQueryKey();
  const q = useGetOfficeSharedReport({
    query: {
      queryKey, enabled: !revoked, refetchInterval: 30_000, refetchOnWindowFocus: true, gcTime: 0, staleTime: 0,
      retry: (n, e) => (e as { status?: number })?.status !== 404 && n < 1,
    },
    request: { headers: { 'X-Office-Share': token }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' },
  });
  const unavailable = (q.error as { status?: number } | null)?.status === 404;
  useEffect(() => {
    if (unavailable) {
      setRevoked(true);
      client.removeQueries({ queryKey });
    }
  }, [unavailable, client]); // Do not re-fetch a revoked capability.
  const [project, setProject] = useState<number | 'all'>('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const data = q.isError ? undefined : q.data;

  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) =>
    (project === 'all' || t.projectId === project) && (status === 'all' || t.status === status) &&
    `${t.title} ${t.assigneeName ?? ''} ${t.projectName}`.toLowerCase().includes(search.trim().toLowerCase())), [data, project, status, search]);
  const scopeTasks = useMemo(() => (data?.tasks ?? []).filter((t) => project === 'all' || t.projectId === project), [data, project]);

  if (revoked || unavailable) return <Notice title="هذا الرابط لم يعد صالحًا" body="الرابط غير صحيح أو أوقفه مدير المكتب. اطلب منه رابطًا جديدًا." />;
  if (q.isError) return <Notice title="تعذّر تحميل التقرير" body="تحقق من الاتصال ثم حاول مرة أخرى." retry={() => void q.refetch()} />;
  if (!data) return <div className="mt-6 space-y-4" aria-label="جارٍ التحميل"><div className="skeleton h-40 rounded-[22px]" /><div className="skeleton h-14" /><div className="panel p-4 space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}</div></div>;

  const counts = { todo: 0, in_progress: 0, review: 0, done: 0 } as Record<string, number>;
  scopeTasks.forEach((t) => { counts[t.status] = (counts[t.status] ?? 0) + 1; });
  const pct = scopeTasks.length ? Math.round((counts.done / scopeTasks.length) * 100) : 0;
  const late = scopeTasks.filter((t) => t.status !== 'done' && new Date(t.dueDate) < new Date()).length;
  const filesByTask = new Map<number, OfficeAttachment[]>();
  data.files.forEach((f) => { if (f.taskId != null) filesByTask.set(f.taskId, [...(filesByTask.get(f.taskId) ?? []), f]); });
  const projectFiles = data.files.filter((f) => f.taskId == null && f.projectId != null && (project === 'all' || f.projectId === project));
  const pname = new Map(data.projects.map((p) => [p.id, p.name]));
  const current = project === 'all' ? null : data.projects.find((p) => p.id === project);

  return <div className="mt-2">
    <section className="progress-hero">
      <div>
        <p className="progress-kicker">{data.title}</p>
        <span className="progress-percent">{pct.toLocaleString('ar-EG')}<small>٪ مكتمل</small></span>
        <p className="progress-sub">{current ? (current.description || current.name) : `${data.projects.length.toLocaleString('ar-EG')} مشروع في هذا التقرير`} · آخر تحديث {fmtDate(data.updatedAt, true)}{q.isFetching && ' · جارٍ التحديث'}</p>
      </div>
      <div className="progress-split">
        <div className="progress-split-item is-done"><span>مكتملة</span><strong>{counts.done.toLocaleString('ar-EG')}</strong></div>
        <div className="progress-split-item is-left"><span>متبقية</span><strong>{(scopeTasks.length - counts.done).toLocaleString('ar-EG')}</strong>{late > 0 && <em>{late.toLocaleString('ar-EG')} متأخرة</em>}</div>
      </div>
      <div className="progress-hero-bar"><div className="work-bar work-bar-tall">{['done', 'review', 'in_progress', 'todo'].map((s) => counts[s] ? <span key={s} style={{ width: `${(counts[s] / scopeTasks.length) * 100}%`, background: statusColor[s] }} /> : null)}</div></div>
    </section>

    <div className="panel mt-6 p-4">
      <div className="task-filter-controls">
        <div className="relative min-w-0 flex-1"><Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a938c]" /><input className="field pr-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالمهمة أو المهندس..." aria-label="بحث" /></div>
        {data.projects.length > 1 && <select className="field task-project-select" value={project} onChange={(e) => setProject(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="المشروع">
          <option value="all">كل المشاريع</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
      </div>
      <div className="task-status-choices">{['all', 'todo', 'in_progress', 'review', 'done'].map((s) =>
        <button key={s} className={`task-status-choice ${status === s ? 'selected' : ''}`} onClick={() => setStatus(s)} aria-pressed={status === s}>{s === 'all' ? 'الكل' : statusLabel[s]}<span className="chip-count">{(s === 'all' ? scopeTasks.length : counts[s] ?? 0).toLocaleString('ar-EG')}</span></button>)}</div>
    </div>

    <section className="panel mt-6 px-4 sm:px-5" aria-label="المهام">
      <div className="task-list-heading -mx-4 sm:-mx-5"><span>المهمة</span><span>المشروع</span><span>المسؤول</span></div>
      {tasks.length ? tasks.map((t) => <SharedTask key={t.id} task={t} files={filesByTask.get(t.id) ?? []} token={token} />)
        : <p className="py-10 text-center text-sm text-[#78837d]">{data.tasks.length ? 'لا توجد مهام مطابقة. غيّر البحث أو الفلتر.' : 'لا توجد مهام في هذا النطاق بعد.'}</p>}
    </section>

    <section className="panel mt-6 px-4 py-4 sm:px-5" aria-labelledby="pfiles">
      <h2 id="pfiles" className="font-bold text-[#304743]">ملفات المشاريع <span className="font-mono text-xs text-[#87918b]">({projectFiles.length.toLocaleString('ar-EG')})</span></h2>
      {projectFiles.length ? <ul className="divide-y divide-[#eeece4]">{projectFiles.map((f) => <FileRow key={f.id} file={f} token={token} label={project === 'all' ? pname.get(f.projectId!) : undefined} />)}</ul>
        : <p className="mt-2 text-xs text-[#87918b]">لا توجد ملفات على مستوى المشروع.</p>}
    </section>
    <p className="mt-6 text-center text-[11px] text-[#929990]">صفحة متابعة للقراءة فقط، تتحدث تلقائيًا كل ٣٠ ثانية.</p>
  </div>;
}

export default function FollowPage() {
  const [token, setToken] = useState(readToken);
  // Isolate each capability's cache without putting secrets into query keys.
  // Replacing the fragment must never briefly show the previous link's scope.
  const client = useMemo(() => new QueryClient(), [token]);
  useEffect(() => () => client.clear(), [client]);
  useEffect(() => setMeta(), []);
  useEffect(() => { const h = () => setToken(readToken()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return <Shell><QueryClientProvider client={client}>{token ? <Report key={token} token={token} /> : <Notice title="الرابط غير مكتمل" body="افتح الرابط كاملًا كما وصلك من مدير المكتب الفني." />}</QueryClientProvider></Shell>;
}
