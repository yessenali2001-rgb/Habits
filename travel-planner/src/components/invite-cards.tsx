'use client';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { acceptInviteById, declineInvite } from '@/app/actions/invites';
import { Button, Card } from './ui';
import { useToast } from './toast';
import { formatDateRange } from '@/lib/time';

export interface PendingInvite {
  id: string; trip_name: string; destination: string | null; start_date: string; end_date: string; role: string; inviter_name: string;
}

export function InviteCards({ invites }: { invites: PendingInvite[] }) {
  const [pending, start] = useTransition();
  const [hidden, setHidden] = useState<string[]>([]);
  const { toast } = useToast();
  const shown = invites.filter((i) => !hidden.includes(i.id));
  if (!shown.length) return null;
  return (
    <section aria-labelledby="inv-h" className="space-y-3">
      <h2 id="inv-h" className="text-lg font-semibold">Invitations <span className="text-muted">({shown.length})</span></h2>
      {shown.map((i) => (
        <Card key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-brand/40 p-4">
          <div>
            <p className="font-medium">{i.trip_name}</p>
            <p className="text-sm text-muted">
              {i.inviter_name} invited you as <strong className="capitalize">{i.role}</strong> · {formatDateRange(i.start_date, i.end_date)}{i.destination ? ` · ${i.destination}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" loading={pending} onClick={() => start(async () => {
              const r = await acceptInviteById(i.id);
              if (r && !r.ok) toast(r.error, 'danger');
            })}><Check className="h-4 w-4" aria-hidden />Accept</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => {
              const r = await declineInvite(i.id);
              if (r.ok) setHidden((h) => [...h, i.id]); else toast(r.error, 'danger');
            })}><X className="h-4 w-4" aria-hidden />Decline</Button>
          </div>
        </Card>
      ))}
    </section>
  );
}
