import type { Metadata } from 'next';
import { ChecklistsManager } from '@/components/checklists-manager';
import { getTripContext } from '@/lib/auth';
import { loadProfiles } from '@/lib/data';
import type { TripTask } from '@/lib/types';

export const metadata: Metadata = { title: 'Checklists' };

export default async function ChecklistsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, user, role } = await getTripContext(tripId);
  const [tasks, parts] = await Promise.all([
    supabase.from('trip_tasks').select('id, trip_id, kind, title, assignee_id, due_date, done').eq('trip_id', tripId).order('done').order('created_at'),
    supabase.from('trip_participants').select('user_id').eq('trip_id', tripId),
  ]);
  const ids = ((parts.data ?? []) as { user_id: string }[]).map((p) => p.user_id);
  const profiles = await loadProfiles(supabase, ids);
  const people = ids.map((id) => ({ id, name: profiles.get(id)?.display_name ?? 'Former member', avatar: profiles.get(id)?.avatar_url ?? null }));
  return <ChecklistsManager tripId={tripId} me={user.id} canEdit={role !== 'viewer'} tasks={(tasks.data ?? []) as TripTask[]} people={people} />;
}
