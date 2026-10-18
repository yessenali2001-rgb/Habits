'use client';
import { CalendarPlus, Download, ExternalLink, FileText, MapPin, Paperclip, Pencil, Trash2, Upload } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { addComment, deleteAttachment, deleteComment, getAttachmentUrl, registerAttachment } from '@/app/actions/itinerary';
import { getBrowserClient } from '@/lib/supabase/client';
import { useToast } from './toast';
import { Alert, Avatar, Badge, Button, Dialog, Textarea } from './ui';
import { googleCalendarUrl, outlookCalendarUrl } from '@/lib/ics';
import { formatDayLong, formatItemTimes, inViewerZone, relativeFromNow, zoneAbbr } from '@/lib/time';
import { kindMeta, type ItineraryItem, type Trip } from '@/lib/types';

export interface CommentRow { id: string; item_id: string | null; user_id: string; body: string; created_at: string }
export interface AttachmentRow { id: string; item_id: string; file_name: string; mime_type: string; size_bytes: number }
export type People = Record<string, { name: string; avatar: string | null }>;

export const mapsLink = (i: Pick<ItineraryItem, 'lat' | 'lng' | 'location_name' | 'address'>) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(i.lat != null && i.lng != null ? `${i.lat},${i.lng}` : [i.location_name, i.address].filter(Boolean).join(', '))}`;

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];

export function ItemDetailDialog({ open, onClose, trip, item, canEdit, isOwner, userId, viewerZone, comments, attachments, people, onEdit, siteOrigin }: {
  open: boolean; onClose: () => void; trip: Trip; item: ItineraryItem | null; canEdit: boolean; isOwner: boolean; userId: string; viewerZone: string;
  comments: CommentRow[]; attachments: AttachmentRow[]; people: People; onEdit: () => void; siteOrigin: string;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!item) return <Dialog open={false} onClose={onClose} title="">{null}</Dialog>;

  const ics = { id: item.id, title: item.title, kind: item.kind, notes: item.notes, location_name: item.location_name, address: item.address, lat: item.lat, lng: item.lng,
    start_local: item.start_local, end_local: item.end_local, all_day: item.all_day, timezone: item.timezone, end_timezone: item.end_timezone,
    starts_at: item.starts_at, ends_at: item.ends_at, updated_at: item.updated_at, links: item.links };
  const kind = kindMeta(item.kind);
  const mine = inViewerZone(item, viewerZone);
  const itemComments = comments.filter((c) => c.item_id === item.id);
  const files = attachments.filter((a) => a.item_id === item.id);

  async function upload(file: File) {
    if (!ALLOWED.includes(file.type)) { toast('Only images and PDFs can be attached.', 'danger'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Files can be up to 10 MB.', 'danger'); return; }
    const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 80);
    const path = `${trip.id}/${item!.id}/${crypto.randomUUID()}-${safe}`;
    const { error: upErr } = await getBrowserClient().storage.from('trip-files').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) { toast('Upload failed — you may only have view access.', 'danger'); return; }
    const r = await registerAttachment(trip.id, { item_id: item!.id, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size });
    toast(r.ok ? 'File attached' : r.error, r.ok ? 'ok' : 'danger');
  }

  return (
    <Dialog open={open} onClose={onClose} wide title={`${kind.emoji} ${item.title}`}>
      <div className="space-y-5">
        <div className="space-y-1.5 text-sm">
          <p className="font-medium">{formatDayLong(item.start_local.slice(0, 10))}</p>
          <p className="text-muted">
            {formatItemTimes(item)}{!item.all_day && <> · {zoneAbbr(item.starts_at, item.timezone)} <span className="text-xs">({item.timezone})</span></>}
            {mine && <Badge tone="brand" className="ml-2">{mine} for you</Badge>}
          </p>
          {(item.location_name || item.address) && (
            <a href={mapsLink(item)} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 text-brand hover:underline">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{[item.location_name, item.address].filter(Boolean).join(' — ')}</span>
            </a>
          )}
          {item.cost_estimate != null && <p className="text-muted">Estimated cost: {new Intl.NumberFormat('en-US', { style: 'currency', currency: item.cost_currency ?? trip.currency }).format(item.cost_estimate)}</p>}
        </div>
        {item.notes && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{item.notes}</p>}
        {item.links.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {item.links.map((l, i) => <li key={i}><a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:bg-surface-2"><ExternalLink className="h-3.5 w-3.5" aria-hidden />{l.label}</a></li>)}
          </ul>
        )}

        <section aria-labelledby="cal-h" className="space-y-2 rounded-xl border border-line p-3">
          <h3 id="cal-h" className="flex items-center gap-2 text-sm font-semibold"><CalendarPlus className="h-4 w-4" aria-hidden />Add to my calendar</h3>
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-sm hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={googleCalendarUrl(trip, ics, { baseUrl: siteOrigin })}>Google Calendar</a>
            <a className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-sm hover:bg-surface-2" target="_blank" rel="noopener noreferrer" href={outlookCalendarUrl(trip, ics, { baseUrl: siteOrigin })}>Outlook</a>
            <a className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-2" href={`/api/trips/${trip.id}/ics?item=${item.id}`}><Download className="h-3.5 w-3.5" aria-hidden />Apple / other (.ics)</a>
          </div>
          <p className="text-xs text-muted">This adds a one-time copy to <em>your</em> calendar. To keep everything up to date automatically, use sync or a subscription on the Calendar tab.</p>
        </section>

        <section aria-labelledby="files-h" className="space-y-2">
          <div className="flex items-center justify-between"><h3 id="files-h" className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" aria-hidden />Attachments</h3>
            {canEdit && <><input ref={fileRef} type="file" hidden accept={ALLOWED.join(',')} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(() => upload(f)); }} />
              <Button size="sm" variant="secondary" loading={pending} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" aria-hidden />Add file</Button></>}</div>
          {files.length === 0 ? <p className="text-sm text-muted">No files yet.</p> : (
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <button className="flex min-w-0 items-center gap-2 text-left hover:underline" onClick={async () => {
                    const r = await getAttachmentUrl(trip.id, f.id);
                    if (r.ok) window.open(r.data!.url, '_blank', 'noopener'); else toast(r.error, 'danger');
                  }}><FileText className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{f.file_name}</span><span className="shrink-0 text-xs text-muted">{(f.size_bytes / 1024).toFixed(0)} KB</span></button>
                  {canEdit && <button aria-label={`Remove ${f.file_name}`} className="text-muted hover:text-danger" onClick={async () => { const r = await deleteAttachment(trip.id, f.id); if (!r.ok) toast(r.error, 'danger'); }}><Trash2 className="h-4 w-4" aria-hidden /></button>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="cmt-h" className="space-y-3">
          <h3 id="cmt-h" className="text-sm font-semibold">Comments ({itemComments.length})</h3>
          {itemComments.map((c) => {
            const who = people[c.user_id];
            return (
              <div key={c.id} className="flex gap-3 text-sm">
                <Avatar name={who?.name ?? 'Former member'} src={who?.avatar} size={28} />
                <div className="min-w-0 flex-1"><p><span className="font-medium">{who?.name ?? 'Former member'}</span> <span className="text-xs text-muted">{relativeFromNow(c.created_at)}</span></p>
                  <p className="whitespace-pre-wrap break-words">{c.body}</p></div>
                {(c.user_id === userId || isOwner) && <button aria-label="Delete comment" className="self-start text-muted hover:text-danger" onClick={async () => { const r = await deleteComment(trip.id, c.id); if (!r.ok) toast(r.error, 'danger'); }}><Trash2 className="h-4 w-4" aria-hidden /></button>}
              </div>
            );
          })}
          {error && <Alert tone="danger">{error}</Alert>}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const body = draft.trim(); if (!body) return;
            start(async () => { const r = await addComment(trip.id, { body, item_id: item.id }); if (r.ok) { setDraft(''); setError(null); } else setError(r.error); }); }}>
            <Textarea aria-label="Write a comment" rows={1} value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} placeholder="Write a comment…" className="min-h-10" />
            <Button type="submit" loading={pending} disabled={!draft.trim()}>Post</Button>
          </form>
        </section>

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          {canEdit && <Button variant="secondary" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden />Edit</Button>}
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Dialog>
  );
}
