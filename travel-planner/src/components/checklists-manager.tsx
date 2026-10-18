'use client';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { addTask, assignTask, deleteTask, setTaskDone } from '@/app/actions/people';
import { useToast } from './toast';
import { Avatar, Button, Card, Input, Select } from './ui';
import { formatDay } from '@/lib/time';
import type { TripTask } from '@/lib/types';

type Kind = TripTask['kind'];
const ALL: { kind: Kind; title: string; hint: string; placeholder: string }[] = [
  { kind: 'task', title: 'Tasks & responsibilities', hint: 'Who does what before and during the trip.', placeholder: 'Book the rental car' },
  { kind: 'prep', title: 'Preparation checklist', hint: 'Visas, insurance, bookings, documents…', placeholder: 'Check passport validity' },
  { kind: 'packing', title: 'Packing list', hint: 'Shared list — assign items so nothing is brought twice.', placeholder: 'Sunscreen' },
];

export function ChecklistsManager({ tripId, me, canEdit, tasks, people }: {
  tripId: string; me: string; canEdit: boolean; tasks: TripTask[]; people: { id: string; name: string; avatar: string | null }[];
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<Kind, { title: string; assignee: string; due: string }>>({
    task: { title: '', assignee: '', due: '' }, prep: { title: '', assignee: '', due: '' }, packing: { title: '', assignee: '', due: '' },
  });
  // optimistic ticks: show the change immediately, let the refreshed server data take over afterwards
  const [local, setLocal] = useState<Record<string, boolean>>({});
  useEffect(() => setLocal({}), [tasks]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? 'Something went wrong.', 'danger'); });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {ALL.map(({ kind, title, hint, placeholder }) => {
        const list = tasks.filter((t) => t.kind === kind);
        const doneN = list.filter((t) => local[t.id] ?? t.done).length;
        const d = drafts[kind];
        const set = (patch: Partial<typeof d>) => setDrafts({ ...drafts, [kind]: { ...d, ...patch } });
        return (
          <Card key={kind} className="flex flex-col gap-3 p-5">
            <div><h2 className="font-semibold">{title}</h2><p className="text-xs text-muted">{hint}</p>
              {list.length > 0 && <div className="mt-2 flex items-center gap-2 text-xs text-muted"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-brand" style={{ width: `${(doneN / list.length) * 100}%` }} /></div>{doneN}/{list.length}</div>}</div>
            <ul className="space-y-1">
              {list.map((t) => {
                const who = t.assignee_id ? byId.get(t.assignee_id) : null;
                const mineOrEditor = canEdit || t.assignee_id === me;
                return (
                  <li key={t.id} className="flex items-start gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--brand)]" checked={local[t.id] ?? t.done} disabled={!mineOrEditor} aria-label={t.title}
                      onChange={(e) => { const next = e.target.checked; setLocal((l) => ({ ...l, [t.id]: next })); start(async () => { const r = await setTaskDone(tripId, t.id, next); if (!r.ok) { setLocal((l) => { const c = { ...l }; delete c[t.id]; return c; }); toast(r.error, 'danger'); } }); }} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className={(local[t.id] ?? t.done) ? 'text-muted line-through' : ''}>{t.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {canEdit ? (
                          <Select aria-label={`Assign “${t.title}”`} className="h-7 w-auto max-w-36 py-0 text-xs" value={t.assignee_id ?? ''} disabled={pending} onChange={(e) => run(() => assignTask(tripId, t.id, e.target.value))}>
                            <option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                        ) : who && <span className="inline-flex items-center gap-1"><Avatar name={who.name} src={who.avatar} size={16} />{who.name}</span>}
                        {t.due_date && <span className="inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" aria-hidden />{formatDay(t.due_date)}</span>}
                      </div>
                    </div>
                    {canEdit && <button className="mt-0.5 text-muted hover:text-danger" aria-label={`Delete ${t.title}`} onClick={() => run(() => deleteTask(tripId, t.id))}><Trash2 className="h-4 w-4" aria-hidden /></button>}
                  </li>
                );
              })}
              {list.length === 0 && <li className="text-sm text-muted">Nothing here yet.</li>}
            </ul>
            {canEdit && (
              <form className="mt-auto space-y-2 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); if (!d.title.trim()) return;
                run(async () => { const r = await addTask(tripId, { kind, title: d.title, assignee_id: d.assignee, due_date: d.due }); if (r.ok) set({ title: '', due: '' }); return r; }); }}>
                <Input aria-label={`New item for ${title}`} placeholder={placeholder} maxLength={200} value={d.title} onChange={(e) => set({ title: e.target.value })} />
                <div className="flex gap-2">
                  <Select aria-label="Assign to" className="h-9 text-xs" value={d.assignee} onChange={(e) => set({ assignee: e.target.value })}><option value="">Unassigned</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                  {kind !== 'packing' && <Input aria-label="Due date" type="date" className="h-9 text-xs" value={d.due} onChange={(e) => set({ due: e.target.value })} />}
                  <Button type="submit" size="sm" disabled={!d.title.trim()} loading={pending} aria-label="Add"><Plus className="h-4 w-4" aria-hidden /></Button>
                </div>
              </form>
            )}
          </Card>
        );
      })}
    </div>
  );
}
