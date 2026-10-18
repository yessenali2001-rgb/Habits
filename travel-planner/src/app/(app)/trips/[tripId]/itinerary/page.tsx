import type { Metadata } from 'next';
import { ItineraryBoard } from '@/components/itinerary-board';
import type { AttachmentRow, CommentRow, People } from '@/components/item-detail';
import { getProfile, getTripContext } from '@/lib/auth';
import { loadProfiles } from '@/lib/data';
import { siteUrl } from '@/lib/env';
import type { Destination, ItineraryItem } from '@/lib/types';

export const metadata: Metadata = { title: 'Itinerary' };

export default async function ItineraryPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, user, trip, role } = await getTripContext(tripId);
  const [profile, items, dests, comments, files, parts] = await Promise.all([
    getProfile(user.id),
    supabase.from('itinerary_items').select('*').eq('trip_id', tripId).order('start_local'),
    supabase.from('destinations').select('*').eq('trip_id', tripId).order('position').order('created_at'),
    supabase.from('comments').select('id, item_id, user_id, body, created_at').eq('trip_id', tripId).order('created_at'),
    supabase.from('item_attachments').select('id, item_id, file_name, mime_type, size_bytes').eq('trip_id', tripId).order('created_at'),
    supabase.from('trip_participants').select('user_id').eq('trip_id', tripId),
  ]);
  const ids = [...((parts.data ?? []) as { user_id: string }[]).map((p) => p.user_id), ...((comments.data ?? []) as CommentRow[]).map((c) => c.user_id)];
  const profiles = await loadProfiles(supabase, ids);
  const people: People = Object.fromEntries([...profiles].map(([id, p]) => [id, { name: p.display_name, avatar: p.avatar_url }]));

  return (
    <ItineraryBoard trip={trip} role={role} userId={user.id} viewerZone={profile.timezone} siteOrigin={siteUrl()}
      items={(items.data ?? []) as ItineraryItem[]} destinations={(dests.data ?? []) as Destination[]}
      comments={(comments.data ?? []) as CommentRow[]} attachments={(files.data ?? []) as AttachmentRow[]} people={people} />
  );
}
