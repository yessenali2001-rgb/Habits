'use client';
import { Copy, Link2, LogOut, MailPlus, ShieldCheck, Trash2, UserMinus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { createInvite, revokeInvite, type CreatedInvite } from '@/app/actions/invites';
import { leaveTrip, removeParticipant, saveDetails, savePrivate, setRole, setStatus } from '@/app/actions/people';
import { useToast } from './toast';
import { Alert, Avatar, Badge, Button, Card, Field, Input, Select, Textarea } from './ui';
import { relativeFromNow } from '@/lib/time';
import type { InviteRow, RsvpStatus, TripRole } from '@/lib/types';

export interface PersonRow { user_id: string; role: TripRole; status: RsvpStatus; name: string; avatar: string | null; dietary: string | null; note: string | null }
export interface PrivateInfo { phone: string | null; emergency_name: string | null; emergency_phone: string | null; medical_notes: string | null }

const STATUS_LABEL: Record<RsvpStatus, string> = { invited: 'Invited', going: 'Going', maybe: 'Maybe', declined: "Can't go" };

export function PeopleManager({ tripId, me, myRole, people, invites, myDetails, myPrivate, privateByUser, emailEnabled }: {
  tripId: string; me: string; myRole: TripRole; people: PersonRow[]; invites: InviteRow[]; myDetails: { dietary: string; note: string };
  myPrivate: PrivateInfo | null; privateByUser: Record<string, PrivateInfo>; emailEnabled: boolean;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const isOwner = myRole === 'owner';
  const [inv, setInv] = useState({ email: '', role: 'editor' as 'editor' | 'viewer', days: 14 });
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [det, setDet] = useState(myDetails);
  const [priv, setPriv] = useState({ phone: myPrivate?.phone ?? '', emergency_name: myPrivate?.emergency_name ?? '', emergency_phone: myPrivate?.emergency_phone ?? '', medical_notes: myPrivate?.medical_notes ?? '' });
  const [openPrivate, setOpenPrivate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    start(async () => { const r = await fn(); if (!r.ok) toast(r.error ?? 'Something went wrong.', 'danger'); else if (okMsg) toast(okMsg); });
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Link copied'); } catch { toast('Copy failed — select the link and copy it manually.', 'danger'); } };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">Travellers ({people.length})</h2>
          <ul className="divide-y divide-line">
            {people.map((p) => {
              const canChangeStatus = p.user_id === me || isOwner;
              const info = privateByUser[p.user_id];
              return (
                <li key={p.user_id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar name={p.name} src={p.avatar} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.name}{p.user_id === me && <span className="ml-1.5 text-xs text-muted">(you)</span>}</p>
                      {p.role === 'owner' || !isOwner ? <Badge tone={p.role === 'owner' ? 'brand' : 'neutral'} className="capitalize">{p.role === 'owner' ? 'Owner' : p.role}</Badge> : (
                        <Select aria-label={`Role of ${p.name}`} className="mt-1 h-8 w-36 text-xs" value={p.role} disabled={pending}
                          onChange={(e) => act(() => setRole(tripId, p.user_id, e.target.value as 'editor' | 'viewer'), 'Role updated')}><option value="editor">Can edit</option><option value="viewer">View only</option></Select>
                      )}
                    </div>
                    {canChangeStatus ? (
                      <Select aria-label={`Attendance of ${p.name}`} className="h-8 w-32 text-xs" value={p.status} disabled={pending} onChange={(e) => act(() => setStatus(tripId, p.user_id, e.target.value as RsvpStatus))}>
                        {(Object.keys(STATUS_LABEL) as RsvpStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
                    ) : <Badge tone={p.status === 'going' ? 'ok' : p.status === 'declined' ? 'danger' : 'neutral'}>{STATUS_LABEL[p.status]}</Badge>}
                    {isOwner && p.role !== 'owner' && <Button variant="ghost" size="sm" className="text-danger" aria-label={`Remove ${p.name}`} onClick={() => { if (confirm(`Remove ${p.name} from this trip?`)) act(() => removeParticipant(tripId, p.user_id), `${p.name} removed`); }}><UserMinus className="h-4 w-4" aria-hidden /></Button>}
                    {p.user_id === me && p.role !== 'owner' && <Button variant="ghost" size="sm" onClick={() => { if (confirm('Leave this trip? You will lose access to its itinerary.')) start(async () => { const r = await leaveTrip(tripId); if (r && !r.ok) toast(r.error, 'danger'); }); }}><LogOut className="h-4 w-4" aria-hidden />Leave</Button>}
                  </div>
                  {(p.dietary || p.note) && <p className="ml-[52px] text-sm text-muted">{p.dietary && <>🍽 {p.dietary}</>}{p.dietary && p.note && ' · '}{p.note}</p>}
                  {isOwner && info && (info.phone || info.emergency_name || info.emergency_phone || info.medical_notes) && (
                    <div className="ml-[52px]">
                      <button className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline" aria-expanded={openPrivate === p.user_id} onClick={() => setOpenPrivate(openPrivate === p.user_id ? null : p.user_id)}><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Private contact &amp; emergency info (only you and {p.name.split(' ')[0]} can see this)</button>
                      {openPrivate === p.user_id && (
                        <dl className="mt-2 grid gap-1 rounded-xl bg-surface-2 p-3 text-sm sm:grid-cols-2">
                          {info.phone && <><dt className="text-muted">Phone</dt><dd>{info.phone}</dd></>}
                          {info.emergency_name && <><dt className="text-muted">Emergency contact</dt><dd>{info.emergency_name}</dd></>}
                          {info.emergency_phone && <><dt className="text-muted">Emergency phone</dt><dd>{info.emergency_phone}</dd></>}
                          {info.medical_notes && <><dt className="text-muted">Medical notes</dt><dd className="whitespace-pre-wrap">{info.medical_notes}</dd></>}
                        </dl>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {isOwner && (
          <Card className="space-y-4 p-5">
            <h2 className="font-semibold">Invite people</h2>
            <p className="text-sm text-muted">Leave the e-mail empty to get a shareable link anyone can use (up to 25 people). With an e-mail, the invitation works only for that address.{!emailEnabled && ' E-mail sending is not configured on this server, so you will share the link yourself.'}</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem_6rem]">
              <Field label="E-mail (optional)" htmlFor="inv-email"><Input id="inv-email" type="email" placeholder="friend@example.com" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
              <Field label="Role" htmlFor="inv-role"><Select id="inv-role" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as 'editor' | 'viewer' })}><option value="editor">Can edit</option><option value="viewer">View only</option></Select></Field>
              <Field label="Valid for" htmlFor="inv-days"><Select id="inv-days" value={inv.days} onChange={(e) => setInv({ ...inv, days: Number(e.target.value) })}>{[1, 7, 14, 30, 90].map((d) => <option key={d} value={d}>{d} {d === 1 ? 'day' : 'days'}</option>)}</Select></Field>
            </div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button loading={pending} onClick={() => { setError(null); start(async () => {
              const r = await createInvite(tripId, inv);
              if (!r.ok) { setError(r.error); return; }
              setCreated(r.data!); setInv({ ...inv, email: '' });
            }); }}>{inv.email ? <><MailPlus className="h-4 w-4" aria-hidden />Send invitation</> : <><Link2 className="h-4 w-4" aria-hidden />Create invite link</>}</Button>

            {created && (
              <Alert tone={created.note ? 'warn' : 'ok'} className="space-y-2">
                <p className="font-medium">{created.emailed ? `Invitation e-mailed to ${created.email}.` : created.email ? `Invitation created for ${created.email}.` : 'Invite link created.'}</p>
                {created.note && <p>{created.note}</p>}
                <div className="flex gap-2"><Input readOnly value={created.link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} className="bg-surface" />
                  <Button variant="secondary" aria-label="Copy invitation link" onClick={() => copy(created.link)}><Copy className="h-4 w-4" aria-hidden /></Button></div>
                <p className="text-xs">This link is shown only now — we store just a hash of it. Anyone with it can join, so share it privately.</p>
              </Alert>
            )}

            {invites.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Open invitations</h3>
                <ul className="divide-y divide-line text-sm">
                  {invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{i.email ?? 'Shareable link'} <span className="text-muted">· {i.role} · {i.uses}/{i.max_uses} used · expires {relativeFromNow(i.expires_at)}</span></span>
                      <Button size="sm" variant="ghost" className="text-danger" aria-label="Revoke invitation" onClick={() => act(() => revokeInvite(tripId, i.id), 'Invitation revoked')}><Trash2 className="h-4 w-4" aria-hidden />Revoke</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </div>

      <aside className="space-y-6">
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">About me <span className="text-xs font-normal text-muted">· visible to everyone on the trip</span></h2>
          <Field label="Dietary needs / allergies" htmlFor="m-diet"><Input id="m-diet" maxLength={500} value={det.dietary} onChange={(e) => setDet({ ...det, dietary: e.target.value })} placeholder="Vegetarian, no nuts…" /></Field>
          <Field label="Note for the group" htmlFor="m-note"><Input id="m-note" maxLength={500} value={det.note} onChange={(e) => setDet({ ...det, note: e.target.value })} placeholder="Arriving a day late…" /></Field>
          <Button size="sm" loading={pending} onClick={() => act(() => saveDetails(tripId, det), 'Saved')}>Save</Button>
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-brand" aria-hidden />My private details</h2>
          <p className="text-xs text-muted">Only you and the trip owner can read these. Other travellers — even editors — cannot.</p>
          <Field label="Phone" htmlFor="p-phone"><Input id="p-phone" type="tel" maxLength={40} value={priv.phone} onChange={(e) => setPriv({ ...priv, phone: e.target.value })} /></Field>
          <Field label="Emergency contact" htmlFor="p-en"><Input id="p-en" maxLength={100} value={priv.emergency_name} onChange={(e) => setPriv({ ...priv, emergency_name: e.target.value })} /></Field>
          <Field label="Emergency phone" htmlFor="p-ep"><Input id="p-ep" type="tel" maxLength={40} value={priv.emergency_phone} onChange={(e) => setPriv({ ...priv, emergency_phone: e.target.value })} /></Field>
          <Field label="Medical notes" htmlFor="p-med"><Textarea id="p-med" rows={2} maxLength={1000} value={priv.medical_notes} onChange={(e) => setPriv({ ...priv, medical_notes: e.target.value })} /></Field>
          <Button size="sm" loading={pending} onClick={() => act(() => savePrivate(tripId, priv), 'Saved privately')}>Save</Button>
        </Card>
      </aside>
    </div>
  );
}
