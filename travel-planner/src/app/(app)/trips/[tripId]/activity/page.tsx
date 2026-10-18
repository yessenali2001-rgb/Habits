import type { Metadata } from 'next';
import { History } from 'lucide-react';
import { Avatar, Card, EmptyState } from '@/components/ui';
import { getTripContext } from '@/lib/auth';
import { loadProfiles } from '@/lib/data';
import { relativeFromNow } from '@/lib/time';
import type { ActivityRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Activity' };

const FIELD: Record<string, string> = {
  title: 'Title', name: 'Name', notes: 'Notes', kind: 'Type', location_name: 'Place', address: 'Address', start_local: 'Start', end_local: 'End', timezone: 'Time zone',
  end_timezone: 'End time zone', all_day: 'Any time', cost_estimate: 'Estimated cost', cost_currency: 'Currency', links: 'Links', destination_id: 'Destination',
  lat: 'Latitude', lng: 'Longitude', description: 'Description', start_date: 'Start date', end_date: 'End date', currency: 'Currency', budget_total: 'Budget',
  role: 'Role', status: 'Status', amount: 'Amount', category: 'Category', paid_by: 'Paid by', split_mode: 'Split', done: 'Done', assignee_id: 'Assigned to', due_date: 'Due',
  arrive_date: 'Arrive', depart_date: 'Depart', country: 'Country', travel_style: 'Style', archived_at: 'Archived', cover_url: 'Cover', cover_path: 'Cover file', expense_date: 'Date',
};
const HIDDEN_ID_FIELDS = new Set(['paid_by', 'assignee_id', 'destination_id']);

export default async function ActivityPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { supabase } = await getTripContext(tripId);
  const { data } = await supabase.from('activity_log').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }).limit(200);
  const rows = (data ?? []) as ActivityRow[];
  const people = await loadProfiles(supabase, rows.map((r) => r.actor_id ?? '').filter(Boolean));

  if (!rows.length) return <EmptyState icon={<History className="h-6 w-6" aria-hidden />} title="No changes yet">Every change to the trip is recorded here with who made it and when.</EmptyState>;
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold">History</h2>
      <ol className="space-y-4">
        {rows.map((r) => {
          const who = r.actor_id ? people.get(r.actor_id) : null;
          const changes = Object.entries(r.changes ?? {}).filter(([k]) => !HIDDEN_ID_FIELDS.has(k));
          return (
            <li key={r.id} className="flex gap-3">
              <Avatar name={who?.display_name ?? 'System'} src={who?.avatar_url} size={32} />
              <div className="min-w-0 flex-1 text-sm">
                <p><span className="font-medium">{who?.display_name ?? (r.actor_id ? 'Former member' : 'System')}</span> {r.summary} <span className="text-xs text-muted" title={new Date(r.created_at).toLocaleString()}>· {relativeFromNow(r.created_at)}</span></p>
                {changes.length > 0 && (
                  <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">{changes.length} {changes.length === 1 ? 'change' : 'changes'}</summary>
                    <ul className="mt-1 space-y-0.5">{changes.map(([k, v]) => <li key={k}><span className="font-medium text-fg">{FIELD[k] ?? k}:</span> {v.from ?? '—'} <span aria-hidden>→</span><span className="sr-only">changed to</span> {v.to ?? '—'}</li>)}</ul></details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
