'use client';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { AlertTriangle, GripVertical, MapPin, MessageSquare, Paperclip, Plus, Route } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { moveItemToDay, reorderItems } from '@/app/actions/itinerary';
import { ItemDetailDialog, mapsLink, type AttachmentRow, type CommentRow, type People } from './item-detail';
import { ItemFormDialog } from './item-form';
import { useToast } from './toast';
import { Alert, Badge, Button, EmptyState } from './ui';
import { findOverlaps } from '@/lib/overlap';
import { addDays, composeLocal, diffDays, eachDay, formatDay, formatItemTimes, inViewerZone, zoneAbbr } from '@/lib/time';
import { kindMeta, type Destination, type ItineraryItem, type Trip } from '@/lib/types';

interface Props {
  trip: Trip; role: 'owner' | 'editor' | 'viewer'; userId: string; viewerZone: string; siteOrigin: string;
  items: ItineraryItem[]; destinations: Destination[]; comments: CommentRow[]; attachments: AttachmentRow[]; people: People;
}

const money = (n: number, c: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${c}`; } };
const flexSort = (a: ItineraryItem, b: ItineraryItem) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
const timedSort = (a: ItineraryItem, b: ItineraryItem) => a.starts_at.localeCompare(b.starts_at) || flexSort(a, b);

export function ItineraryBoard(props: Props) {
  const { trip, role, userId, viewerZone, destinations, comments, attachments, people, siteOrigin } = props;
  const canEdit = role !== 'viewer';
  const { toast } = useToast();
  const [items, setItems] = useState(props.items);
  useEffect(() => setItems(props.items), [props.items]);

  const [form, setForm] = useState<{ item: ItineraryItem | null; date: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const detail = items.find((i) => i.id === detailId) ?? null;

  const days = useMemo(() => {
    const set = new Set([...eachDay(trip.start_date, trip.end_date), ...items.map((i) => i.day_date)]);
    return [...set].sort();
  }, [trip.start_date, trip.end_date, items]);
  const overlaps = useMemo(() => findOverlaps(items), [items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const destFor = (date: string) => destinations.find((d) => d.arrive_date && d.depart_date && d.arrive_date <= date && date <= d.depart_date);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd(e: DragEndEvent) {
    setDragId(null);
    const { active, over } = e;
    if (!over || !canEdit) return;
    const a = byId.get(String(active.id));
    const overId = String(over.id);
    const targetDate = overId.startsWith('day:') ? overId.slice(4) : byId.get(overId)?.day_date;
    if (!a || !targetDate) return;

    if (targetDate !== a.day_date) {                                   // move to another day (keeps the time of day)
      const before = items;
      const delta = diffDays(a.day_date, targetDate);
      const shift = (l: string) => composeLocal(addDays(l.slice(0, 10), delta), l.slice(11, 16));
      setItems((cur) => cur.map((i) => (i.id === a.id ? { ...i, day_date: targetDate, start_local: shift(i.start_local), end_local: i.end_local ? shift(i.end_local) : null } : i)));
      const r = await moveItemToDay(trip.id, a.id, targetDate);
      if (!r.ok) { setItems(before); toast(r.error, 'danger'); } else toast(`Moved to ${formatDay(targetDate)}`);
      return;
    }
    const b = byId.get(overId);
    if (!b || a.id === b.id) return;
    if (!a.all_day || !b.all_day) { toast('Timed items are ordered by their time — edit the time to move them within the day.'); return; }
    const flex = items.filter((i) => i.day_date === a.day_date && i.all_day).sort(flexSort);
    const moved = arrayMove(flex, flex.findIndex((i) => i.id === a.id), flex.findIndex((i) => i.id === b.id));
    const before = items;
    setItems((cur) => cur.map((i) => { const k = moved.findIndex((m) => m.id === i.id); return k >= 0 ? { ...i, sort_order: k } : i; }));
    const r = await reorderItems(trip.id, moved.map((m) => m.id));
    if (!r.ok) { setItems(before); toast(r.error, 'danger'); }
  }

  const dragged = dragId ? byId.get(dragId) : null;

  return (
    <div className="space-y-6">
      {/* overall trip timeline */}
      <nav aria-label="Trip timeline" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ol className="flex min-w-max gap-2 pb-1">
          {days.map((d, k) => {
            const n = items.filter((i) => i.day_date === d).length;
            const clash = items.some((i) => i.day_date === d && overlaps.has(i.id));
            const dest = destFor(d);
            return (
              <li key={d}>
                <a href={`#day-${d}`} className="block w-28 rounded-xl border border-line bg-surface p-2.5 text-center text-xs transition hover:border-brand">
                  <span className="block text-muted">Day {k + 1}</span><span className="block whitespace-nowrap text-sm font-semibold">{formatDay(d)}</span>
                  <span className="mt-1 block truncate text-muted">{dest?.name ?? ' '}</span>
                  <span className="mt-1 flex items-center justify-center gap-1">{n > 0 ? <Badge tone="brand">{n}</Badge> : <Badge>0</Badge>}{clash && <AlertTriangle className="h-3.5 w-3.5 text-warn" aria-label="Overlapping items" />}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      {!canEdit && <Alert tone="neutral">You have view-only access. You can read everything, add comments and add items to your own calendar.</Alert>}
      {canEdit && items.length > 1 && <p className="text-xs text-muted">Tip: drag the <GripVertical className="inline h-3 w-3" aria-hidden /> handle to another day to move an item. Timed items sort by time automatically; “any time” items can also be reordered by dragging.</p>}

      {items.length === 0 && (
        <EmptyState icon={<Route className="h-6 w-6" aria-hidden />} title="Your itinerary is empty"
          action={canEdit ? <Button onClick={() => setForm({ item: null, date: trip.start_date })}><Plus className="h-4 w-4" aria-hidden />Add the first item</Button> : undefined}>
          {canEdit ? 'Add activities, restaurants, transport and hotels. Everyone on the trip will see them instantly.' : 'The organizers have not added anything yet.'}
        </EmptyState>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))} onDragCancel={() => setDragId(null)} onDragEnd={onDragEnd}>
        <div className="space-y-5">
          {days.map((d, k) => (
            <DaySection key={d} date={d} index={k} trip={trip} dest={destFor(d)} canEdit={canEdit} items={items.filter((i) => i.day_date === d)}
              overlaps={overlaps} byId={byId} viewerZone={viewerZone} comments={comments} attachments={attachments}
              onAdd={() => setForm({ item: null, date: d })} onOpen={(id) => setDetailId(id)} />
          ))}
        </div>
        <DragOverlay>{dragged ? <div className="rounded-xl border border-brand bg-surface p-3 text-sm font-medium shadow-xl">{kindMeta(dragged.kind).emoji} {dragged.title}</div> : null}</DragOverlay>
      </DndContext>

      {canEdit && form && <ItemFormDialog open onClose={() => setForm(null)} trip={trip} destinations={destinations} item={form.item} date={form.date} />}
      <ItemDetailDialog open={!!detail} onClose={() => setDetailId(null)} trip={trip} item={detail} canEdit={canEdit} isOwner={role === 'owner'} userId={userId}
        viewerZone={viewerZone} comments={comments} attachments={attachments} people={people} siteOrigin={siteOrigin}
        onEdit={() => { if (detail) { setForm({ item: detail, date: detail.day_date }); setDetailId(null); } }} />
    </div>
  );
}

function DaySection({ date, index, trip, dest, canEdit, items, overlaps, byId, viewerZone, comments, attachments, onAdd, onOpen }: {
  date: string; index: number; trip: Trip; dest?: Destination; canEdit: boolean; items: ItineraryItem[]; overlaps: Map<string, string[]>;
  byId: Map<string, ItineraryItem>; viewerZone: string; comments: CommentRow[]; attachments: AttachmentRow[]; onAdd: () => void; onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}`, disabled: !canEdit });
  const flex = items.filter((i) => i.all_day).sort(flexSort);
  const timed = items.filter((i) => !i.all_day).sort(timedSort);
  const outside = date < trip.start_date || date > trip.end_date;
  const clashes = items.filter((i) => overlaps.has(i.id)).length;

  const totals = new Map<string, number>();
  for (const i of items) if (i.cost_estimate != null) totals.set(i.cost_currency ?? trip.currency, (totals.get(i.cost_currency ?? trip.currency) ?? 0) + i.cost_estimate);

  return (
    <section id={`day-${date}`} ref={setNodeRef} aria-labelledby={`h-${date}`}
      className={clsx('scroll-mt-24 rounded-2xl border bg-surface p-4 shadow-card transition-colors sm:p-5', isOver ? 'border-brand bg-brand-soft/30' : 'border-line')}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id={`h-${date}`} className="text-base font-semibold">
            <span className="text-muted">Day {index + 1} · </span>{formatDay(date)}{dest && <span className="font-normal text-muted"> — {dest.name}</span>}
          </h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {outside && <Badge tone="warn">Outside the trip dates</Badge>}
            {totals.size > 0 && <span>Est. {[...totals].map(([c, n]) => money(n, c)).join(' + ')}</span>}
            {dest && dest.timezone !== trip.timezone && <span>Local zone {dest.timezone}</span>}
          </p>
        </div>
        {canEdit && <Button size="sm" variant="secondary" onClick={onAdd}><Plus className="h-4 w-4" aria-hidden />Add</Button>}
      </header>

      {clashes > 0 && <Alert tone="warn" className="mb-3 flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{clashes} {clashes === 1 ? 'item overlaps' : 'items overlap'} another on this day. Check the times marked below.</Alert>}

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Nothing planned{canEdit ? ' — drop an item here or add one.' : '.'}</p>
      ) : (
        <ul className="space-y-2">
          <SortableContext items={flex.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {flex.map((i) => <SortableRow key={i.id} item={i} {...{ canEdit, overlaps, byId, viewerZone, comments, attachments, onOpen, trip }} />)}
          </SortableContext>
          {timed.map((i) => <DraggableRow key={i.id} item={i} {...{ canEdit, overlaps, byId, viewerZone, comments, attachments, onOpen, trip }} />)}
        </ul>
      )}
    </section>
  );
}

type RowProps = { item: ItineraryItem; trip: Trip; canEdit: boolean; overlaps: Map<string, string[]>; byId: Map<string, ItineraryItem>; viewerZone: string; comments: CommentRow[]; attachments: AttachmentRow[]; onOpen: (id: string) => void };

function SortableRow(p: RowProps) {
  const s = useSortable({ id: p.item.id, disabled: !p.canEdit });
  return <ItemRow {...p} nodeRef={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition, opacity: s.isDragging ? 0.4 : 1 }}
    handle={p.canEdit ? <Handle {...s.attributes} {...s.listeners} /> : null} />;
}
function DraggableRow(p: RowProps) {
  const d = useDraggable({ id: p.item.id, disabled: !p.canEdit });
  return <ItemRow {...p} nodeRef={d.setNodeRef} style={{ transform: CSS.Translate.toString(d.transform), opacity: d.isDragging ? 0.4 : 1 }}
    handle={p.canEdit ? <Handle {...d.attributes} {...d.listeners} /> : null} />;
}
function Handle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return <button type="button" aria-label="Drag to move or reorder" {...props} className="mt-0.5 h-8 w-6 shrink-0 cursor-grab touch-none rounded-lg text-muted hover:bg-surface-2 active:cursor-grabbing"><GripVertical className="mx-auto h-4 w-4" aria-hidden /></button>;
}

function ItemRow({ item, trip, overlaps, byId, viewerZone, comments, attachments, onOpen, nodeRef, style, handle }: RowProps & { nodeRef: (n: HTMLElement | null) => void; style: React.CSSProperties; handle: ReactNode }) {
  const kind = kindMeta(item.kind);
  const clash = (overlaps.get(item.id) ?? []).map((id) => byId.get(id)?.title).filter(Boolean);
  const mine = inViewerZone(item, viewerZone);
  const nComments = comments.filter((c) => c.item_id === item.id).length;
  const nFiles = attachments.filter((a) => a.item_id === item.id).length;
  const where = item.location_name || item.address;
  return (
    <li ref={nodeRef} style={style} className={clsx('flex gap-2 rounded-xl border p-3', clash.length ? 'border-warn/50 bg-warn-soft/40' : 'border-line bg-bg/40')}>
      {handle}
      <button type="button" onClick={() => onOpen(item.id)} className="grid min-w-0 flex-1 grid-cols-[4.5rem_1fr] gap-3 text-left sm:grid-cols-[6.5rem_1fr]">
        <span className="text-sm tabular-nums text-muted">
          <span className="block font-medium text-fg">{formatItemTimes(item).split(' (')[0]}</span>
          {!item.all_day && <span className="block text-xs">{zoneAbbr(item.starts_at, item.timezone)}{item.end_timezone && item.end_timezone !== item.timezone && item.ends_at ? ` → ${zoneAbbr(item.ends_at, item.end_timezone)}` : ''}</span>}
          {mine && <span className="mt-0.5 block text-[11px] text-brand">{mine} you</span>}
        </span>
        <span className="min-w-0">
          <span className="flex items-start gap-2"><span aria-hidden className="text-lg leading-6">{kind.emoji}</span><span className="font-medium leading-6 [overflow-wrap:anywhere]">{item.title}</span></span>
          {where && <span className="mt-0.5 flex items-center gap-1 text-sm text-muted"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{where}</span></span>}
          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {item.cost_estimate != null && <span>{money(item.cost_estimate, item.cost_currency ?? trip.currency)}</span>}
            {nComments > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" aria-hidden />{nComments}</span>}
            {nFiles > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" aria-hidden />{nFiles}</span>}
            {item.links.length > 0 && <span>{item.links.length} {item.links.length === 1 ? 'link' : 'links'}</span>}
            {clash.length > 0 && <span className="inline-flex items-center gap-1 font-medium text-warn"><AlertTriangle className="h-3 w-3" aria-hidden />Overlaps with {clash.slice(0, 2).join(', ')}{clash.length > 2 ? ` +${clash.length - 2}` : ''}</span>}
          </span>
        </span>
      </button>
      {where && <a href={mapsLink(item)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${where} in maps`} className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 sm:grid"><MapPin className="h-4 w-4" aria-hidden /></a>}
    </li>
  );
}
