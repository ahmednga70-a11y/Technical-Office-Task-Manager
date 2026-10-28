import { useCallback, useMemo } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import type { Task } from '@workspace/api-client-react';

export const TASK_STATUS_FILTERS = ['all', 'remaining', 'todo', 'in_progress', 'review', 'done'] as const;
export type TaskStatusFilter = typeof TASK_STATUS_FILTERS[number];
export const statusFilterLabel: Record<TaskStatusFilter, string> = {
  all: 'كل المهام', remaining: 'المتبقي', todo: 'لم تبدأ', in_progress: 'قيد التنفيذ', review: 'مراجعة', done: 'مكتملة',
};

export function matchesStatus(task: Task, status: TaskStatusFilter) {
  if (status === 'all') return true;
  if (status === 'remaining') return task.status !== 'done';
  return task.status === status;
}

export type WorkCounts = { total: number; done: number; review: number; in_progress: number; todo: number; remaining: number; percent: number };
export function countWork(tasks: Pick<Task, 'status'>[]): WorkCounts {
  const c = { todo: 0, in_progress: 0, review: 0, done: 0 };
  tasks.forEach(t => { c[t.status] += 1; });
  const total = tasks.length;
  return { total, ...c, remaining: total - c.done, percent: total ? Math.round((c.done / total) * 100) : 0 };
}

/** URL-backed task filters: ?status=&project=&q= — survives reload and back navigation. */
export function useTaskUrlFilters() {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const rawStatus = params.get('status') as TaskStatusFilter | null;
  const status: TaskStatusFilter = rawStatus && TASK_STATUS_FILTERS.includes(rawStatus) ? rawStatus : 'all';
  const project = params.get('project') || 'all';
  const q = params.get('q') || '';
  const set = useCallback((patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(search);
    Object.entries(patch).forEach(([k, v]) => { if (!v || v === 'all') next.delete(k); else next.set(k, v); });
    const qs = next.toString();
    setLocation(`${location}${qs ? `?${qs}` : ''}`, { replace });
  }, [search, location, setLocation]);
  const clear = useCallback(() => setLocation(location), [location, setLocation]);
  return { status, project, q, set, clear, hasFilters: status !== 'all' || project !== 'all' || Boolean(q) };
}

const segColors = { done: '#4f7d48', review: '#d9995f', in_progress: '#5c968a', todo: '#cfc9b2' } as const;

export function WorkBar({ counts, tall = false }: { counts: WorkCounts; tall?: boolean }) {
  return <div className={`work-bar ${tall ? 'work-bar-tall' : ''}`} role="img"
    aria-label={`مكتمل ${counts.done} من ${counts.total}، مراجعة ${counts.review}، قيد التنفيذ ${counts.in_progress}، لم تبدأ ${counts.todo}`}>
    {(['done', 'review', 'in_progress', 'todo'] as const).map(k => counts[k] ? <span key={k} style={{ width: `${(counts[k] / counts.total) * 100}%`, background: segColors[k] }} /> : null)}
  </div>;
}

export function WorkLegend({ counts, hrefFor }: { counts: WorkCounts; hrefFor: (s: TaskStatusFilter) => string }) {
  return <div className="work-legend">
    {(['done', 'review', 'in_progress', 'todo'] as const).map(k => <Link key={k} href={hrefFor(k)} className="work-legend-item" data-testid={`link-work-${k}`}>
      <i style={{ background: segColors[k] }} /><span>{statusFilterLabel[k]}</span><strong>{counts[k]}</strong>
    </Link>)}
  </div>;
}

export function StatusFilterChips({ value, counts, onChange }: { value: TaskStatusFilter; counts: WorkCounts; onChange: (s: TaskStatusFilter) => void }) {
  return <div className="task-status-choices" role="group" aria-label="اختيار حالة المهام">
    {TASK_STATUS_FILTERS.map(s => {
      const n = s === 'all' ? counts.total : counts[s];
      return <button type="button" key={s} className={`task-status-choice ${value === s ? 'selected' : ''}`} aria-pressed={value === s}
        onClick={() => onChange(s)} data-testid={`button-filter-status-${s}`}>{statusFilterLabel[s]} <span className="chip-count">{n}</span></button>;
    })}
  </div>;
}
