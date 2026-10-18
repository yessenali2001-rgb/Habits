import type { Metadata } from 'next';
import { PeopleManager, type PersonRow, type PrivateInfo } from '@/components/people-manager';
import { getTripContext } from '@/lib/auth';
import { loadProfiles, unknownPerson } from '@/lib/data';
import { emailConfigured } from '@/lib/env';
import type { InviteRow, RsvpStatus, TripRole } from '@/lib/types';

export const metadata: Metadata = { title: 'People' };

export default async function PeoplePage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, user, role } = await getTripContext(tripId);
  const isOwner = role === 'owner';

  const [parts, details, priv, invites] = await Promise.all([
    supabase.from('trip_participants').select('user_id, role, status, joined_at').eq('trip_id', tripId).order('joined_at'),
    supabase.from('participant_details').select('user_id, dietary, note').eq('trip_id', tripId),
    // row level security: a normal member only gets their own row here, the owner gets everyone's
    supabase.from('participant_private').select('user_id, phone, emergency_name, emergency_phone, medical_notes').eq('trip_id', tripId),
    isOwner ? supabase.from('trip_invites').select('id, trip_id, email, role, created_at, expires_at, max_uses, uses, revoked_at').eq('trip_id', tripId).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
  ]);
  const rows = (parts.data ?? []) as { user_id: string; role: TripRole; status: RsvpStatus }[];
  const profiles = await loadProfiles(supabase, rows.map((r) => r.user_id));
  const dmap = new Map(((details.data ?? []) as { user_id: string; dietary: string | null; note: string | null }[]).map((d) => [d.user_id, d]));
  const people: PersonRow[] = rows.map((r) => {
    const p = profiles.get(r.user_id) ?? unknownPerson(r.user_id);
    return { user_id: r.user_id, role: r.role, status: r.status, name: p.display_name, avatar: p.avatar_url, dietary: dmap.get(r.user_id)?.dietary ?? null, note: dmap.get(r.user_id)?.note ?? null };
  });
  const privRows = (priv.data ?? []) as (PrivateInfo & { user_id: string })[];
  const mine = privRows.find((p) => p.user_id === user.id) ?? null;
  const others = Object.fromEntries(privRows.filter((p) => p.user_id !== user.id).map((p) => [p.user_id, p]));
  const open = ((invites.data ?? []) as InviteRow[]).filter((i) => i.uses < i.max_uses || i.email === null);

  return (
    <PeopleManager tripId={tripId} me={user.id} myRole={role} people={people} invites={open} emailEnabled={emailConfigured()}
      myDetails={{ dietary: dmap.get(user.id)?.dietary ?? '', note: dmap.get(user.id)?.note ?? '' }} myPrivate={mine} privateByUser={others} />
  );
}
