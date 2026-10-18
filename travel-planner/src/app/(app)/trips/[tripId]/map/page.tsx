import type { Metadata } from 'next';
import { TripMapLoader } from '@/components/trip-map-loader';
import { getTripContext } from '@/lib/auth';
import type { Destination, ItineraryItem } from '@/lib/types';

export const metadata: Metadata = { title: 'Map' };

export default async function MapPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase, trip, role } = await getTripContext(tripId);
  const [items, dests] = await Promise.all([
    supabase.from('itinerary_items').select('*').eq('trip_id', tripId).order('starts_at'),
    supabase.from('destinations').select('*').eq('trip_id', tripId).order('position'),
  ]);
  return <TripMapLoader trip={trip} items={(items.data ?? []) as ItineraryItem[]} destinations={(dests.data ?? []) as Destination[]} canEdit={role !== 'viewer'} />;
}
