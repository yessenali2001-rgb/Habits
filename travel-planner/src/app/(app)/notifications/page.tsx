import type { Metadata } from 'next';
import { BellOff } from 'lucide-react';
import { NotificationsList } from '@/components/notifications-list';
import { EmptyState } from '@/components/ui';
import { emailConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth';
import type { NotificationRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
  const items = (data ?? []) as NotificationRow[];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      {items.length ? <NotificationsList items={items} /> : (
        <EmptyState icon={<BellOff className="h-6 w-6" aria-hidden />} title="Nothing new">Invitations, itinerary changes, comments, assignments and upcoming-activity reminders show up here.</EmptyState>
      )}
      <p className="text-xs text-muted">In-app notifications are always on and arrive live. {emailConfigured() ? 'E-mail copies are sent if you leave them enabled in Settings.' : 'E-mail notifications are not configured on this server.'}</p>
    </div>
  );
}
