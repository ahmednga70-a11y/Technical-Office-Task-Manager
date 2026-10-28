import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Copy, Eye, Link2, LoaderCircle, Plus, RefreshCw, ShieldOff, X } from 'lucide-react';
import {
  getListOfficeShareLinksQueryKey, useCreateOfficeShareLink, useListOfficeShareLinks, useRevokeOfficeShareLink,
} from '@workspace/api-client-react';
import type { OfficeShareLink, Project } from '@workspace/api-client-react';

const fmt = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};

export function buildFollowLink(token: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}follow#${token}`;
}

function CreateShareDialog({ projects, onClose }: { projects: Project[]; onClose: () => void }) {
  const client = useQueryClient();
  const create = useCreateOfficeShareLink();
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) { setError('اكتب عنوانًا يوضح لمن هذا الرابط.'); return; }
    if (scope === 'selected' && selected.length === 0) { setError('اختر مشروعًا واحدًا على الأقل.'); return; }
    create.mutate({ data: { title: title.trim(), scope, projectIds: scope === 'all' ? [] : selected } }, {
      onSuccess: (res) => {
        setCreated(buildFollowLink(res.token));
        client.invalidateQueries({ queryKey: getListOfficeShareLinksQueryKey() });
      },
      onError: () => setError('تعذّر إنشاء الرابط. حاول مرة أخرى.'),
    });
  };
  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created); setCopied(true); } catch { setError('تعذّر النسخ تلقائيًا. حدّد الرابط وانسخه يدويًا.'); }
  };
  const close = () => { if (!create.isPending) { setCreated(null); onClose(); } };

  return <div className="modal-backdrop" onClick={close}>
    <div className="modal" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" onClick={(e) => e.stopPropagation()}>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div><p className="mb-1 text-[11px] font-bold tracking-[.12em] text-[#d77850]">رابط متابعة للقراءة فقط</p><h2 id="share-dialog-title" className="text-xl font-extrabold text-[#203b39]">{created ? 'الرابط جاهز' : 'رابط متابعة جديد'}</h2></div>
        <button className="btn btn-ghost !p-2" onClick={close} aria-label="إغلاق"><X size={18} /></button>
      </div>
      {created ? <div>
        <div className="rounded-xl border border-[#ead8bd] bg-[#faf2e4] p-3 text-xs leading-6 text-[#80643d]">انسخ الرابط الآن. لن يظهر مرة أخرى بعد إغلاق هذه النافذة، وإذا ضاع أنشئ رابطًا جديدًا وألغِ القديم.</div>
        <input readOnly dir="ltr" className="field mt-4 font-mono text-xs" value={created} onFocus={(e) => e.currentTarget.select()} data-testid="input-new-share-link" />
        {error && <p className="mt-3 text-xs text-[#a64d40]" role="alert">{error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn btn-soft" onClick={close}>تم</button>
          <button className="btn btn-primary" onClick={() => void copy()} data-testid="button-copy-share-link">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'تم النسخ' : 'نسخ الرابط'}</button>
        </div>
      </div> : <form onSubmit={submit} noValidate>
        <label className="field-label" htmlFor="share-title">العنوان</label>
        <input id="share-title" className="field" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: متابعة مدير مشروع برج الميناء" data-testid="input-share-title" />
        <fieldset className="mt-5">
          <legend className="field-label">النطاق</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['all', 'كل المشاريع', 'يشمل أي مشروع يُضاف لاحقًا تلقائيًا.'], ['selected', 'مشاريع محددة', 'مشروع واحد أو أكثر تختاره الآن.']] as const).map(([v, l, d]) =>
              <label key={v} className={`cursor-pointer rounded-xl border p-3 transition-colors ${scope === v ? 'border-[#285e59] bg-[#e7efeb]' : 'border-[#e1dfd3] bg-[#f7f5ed]'}`}>
                <input type="radio" name="scope" className="sr-only" checked={scope === v} onChange={() => setScope(v)} data-testid={`radio-scope-${v}`} />
                <span className="block text-sm font-bold text-[#304743]">{l}</span><span className="mt-1 block text-[11px] leading-5 text-[#77827c]">{d}</span>
              </label>)}
          </div>
        </fieldset>
        {scope === 'selected' && <div className="mt-4 max-h-56 overflow-auto rounded-xl border border-[#e1dfd3] p-2">
          {projects.length === 0 ? <p className="p-3 text-xs text-[#87918b]">لا توجد مشاريع بعد.</p> : projects.map((p) =>
            <label key={p.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-[#f2f0e7]">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-[#285e59]" data-testid={`checkbox-share-project-${p.id}`} />
              <span className="min-w-0 truncate text-sm text-[#304743]">{p.name}</span>
            </label>)}
        </div>}
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-[#f2f0e7] p-3 text-[12px] leading-6 text-[#5d6f69]"><Eye size={16} className="mt-1 shrink-0" />أي شخص معه الرابط يستطيع قراءة المهام والمسؤولين والتقدم وفتح الملفات ضمن النطاق، دون تسجيل دخول ودون أي تعديل. يمكنك إلغاؤه في أي وقت.</div>
        {error && <p className="mt-3 flex items-center gap-2 text-xs text-[#a64d40]" role="alert"><AlertCircle size={14} />{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-soft" onClick={close}>إلغاء</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending} data-testid="button-submit-share-link">{create.isPending ? <LoaderCircle size={16} className="animate-spin" /> : <Link2 size={16} />}إنشاء الرابط</button>
        </div>
      </form>}
    </div>
  </div>;
}

export default function ShareLinksPanel({ projects }: { projects: Project[] }) {
  const client = useQueryClient();
  const { data, isLoading, isError, refetch } = useListOfficeShareLinks();
  const revoke = useRevokeOfficeShareLink();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<OfficeShareLink | null>(null);
  const [revokeError, setRevokeError] = useState('');
  const names = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const sorted = useMemo(() => [...(data ?? [])].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || b.createdAt.localeCompare(a.createdAt)), [data]);
  const activeCount = sorted.filter((l) => !l.revokedAt).length;

  const doRevoke = () => {
    if (!confirm) return;
    setRevokeError('');
    revoke.mutate({ linkId: confirm.id }, {
      onSuccess: () => { setConfirm(null); client.invalidateQueries({ queryKey: getListOfficeShareLinksQueryKey() }); },
      onError: () => setRevokeError('تعذّر إلغاء الرابط. حاول مرة أخرى.'),
    });
  };

  return <section className="panel mb-6 overflow-hidden" aria-labelledby="share-links-title" data-testid="panel-share-links">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7e3d8] bg-[#f7f5ee] px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f8e9df] text-[#b35b3d]"><Link2 size={18} /></span>
        <div className="min-w-0"><h2 id="share-links-title" className="font-bold text-[#304743]">روابط متابعة لمديري المشاريع</h2><p className="mt-1 text-xs text-[#87918b]">قراءة فقط، بدون حساب. <span className="font-mono">{activeCount.toLocaleString('ar-EG')}</span> رابط فعّال</p></div>
      </div>
      <button className="btn btn-primary" onClick={() => setOpen(true)} data-testid="button-new-share-link"><Plus size={16} /> رابط جديد</button>
    </header>
    <div className="px-4 py-2 sm:px-5">
      {isLoading ? <div className="space-y-2 py-3">{[0, 1].map((i) => <div key={i} className="skeleton h-12" />)}</div>
        : isError ? <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-[#a64d40]"><span>تعذّر تحميل الروابط.</span><button className="btn btn-soft !py-2" onClick={() => void refetch()}><RefreshCw size={14} /> إعادة المحاولة</button></div>
        : sorted.length === 0 ? <p className="py-5 text-sm leading-7 text-[#78837d]">لا توجد روابط بعد. أنشئ رابطًا لكل مدير مشروع بنطاقه، وألغِ أي رابط منفردًا وقتما تريد.</p>
        : <ul className="divide-y divide-[#eeece4]">{sorted.map((l) => <li key={l.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center" data-testid={`row-share-link-${l.id}`}>
          <div className="min-w-0 flex-1">
            <p className={`break-words text-sm font-bold ${l.revokedAt ? 'text-[#9aa29b] line-through' : 'text-[#304743]'}`}>{l.title}</p>
            <p className="mt-1 break-words text-[11px] leading-5 text-[#87918b]">
              {l.scope === 'all' ? 'كل المشاريع، بما فيها الجديدة' : l.projectIds.map((id) => names.get(id) ?? `مشروع محذوف`).join('، ')}
              <span aria-hidden="true"> · </span>أُنشئ {fmt(l.createdAt)}{l.revokedAt && <> · أُلغي {fmt(l.revokedAt)}</>}
            </p>
          </div>
          {l.revokedAt ? <span className="badge self-start bg-[#f1eee5] text-[#87918b] sm:self-auto">ملغى</span>
            : <div className="flex items-center gap-2 self-start sm:self-auto"><span className="badge bg-[#e0efec] text-[#286960]">فعّال</span><button className="btn btn-danger !px-3 !py-2 text-xs" onClick={() => { setRevokeError(''); setConfirm(l); }} data-testid={`button-revoke-share-link-${l.id}`}><ShieldOff size={14} /> إلغاء</button></div>}
        </li>)}</ul>}
      <p className="border-t border-[#efede5] py-3 text-[10px] leading-5 text-[#929990]">الرابط يظهر مرة واحدة عند إنشائه فقط. لو ضاع، أنشئ رابطًا جديدًا وألغِ القديم.</p>
    </div>
    {open && <CreateShareDialog projects={projects} onClose={() => setOpen(false)} />}
    {confirm && <div className="modal-backdrop" onClick={() => setConfirm(null)}>
      <div className="modal !w-[min(440px,100%)]" dir="rtl" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-extrabold text-[#203b39]">إلغاء رابط «{confirm.title}»؟</h2>
        <p className="mt-3 text-sm leading-7 text-[#6d7a74]">يتوقف فتح البيانات والملفات فورًا، وتختفي البيانات من الصفحة المفتوحة عند التحديث التلقائي خلال ٣٠ ثانية. الملفات التي سبق تنزيلها لا يمكن سحبها. لا يمكن التراجع.</p>
        {revokeError && <p className="mt-3 text-xs text-[#a64d40]" role="alert">{revokeError}</p>}
        <div className="mt-6 flex justify-end gap-2"><button className="btn btn-soft" onClick={() => setConfirm(null)}>تراجع</button><button className="btn btn-danger" disabled={revoke.isPending} onClick={doRevoke} data-testid="button-confirm-revoke">{revoke.isPending ? <LoaderCircle size={15} className="animate-spin" /> : <ShieldOff size={15} />} إلغاء الرابط</button></div>
      </div>
    </div>}
  </section>;
}
