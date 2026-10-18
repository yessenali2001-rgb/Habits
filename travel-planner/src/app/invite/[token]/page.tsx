import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { InviteAccept } from '@/components/invite-accept';
import { getUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDateRange } from '@/lib/time';

export const metadata: Metadata = { title: 'Trip invitation', robots: { index: false } };

const STATUS_TEXT: Record<string, string> = {
  invalid: 'This invitation link is not valid. Ask the organizer for a new one.',
  revoked: 'This invitation was cancelled by the organizer.',
  expired: 'This invitation has expired. Ask the organizer for a new one.',
  exhausted: 'This invitation link has already been used the maximum number of times.',
  wrong_account: 'This invitation was sent to a different e-mail address. Sign out and sign in with the invited address.',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const supabase = await createClient();
  const { data } = await supabase.rpc('preview_invite', { _token: token });
  const p = Array.isArray(data) ? data[0] : data;

  if (p?.status === 'already_member') redirect(`/trips/${p.trip_id}`);

  return (
    <AuthShell>
      <div className="w-full max-w-sm text-center">
        {p?.status === 'valid' ? (
          <>
            <p className="text-sm text-muted">{p.inviter_name} invited you to</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.trip_name}</h1>
            <p className="mt-2 text-sm text-muted">{formatDateRange(p.start_date, p.end_date)}{p.destination ? ` · ${p.destination}` : ''}</p>
            <p className="mt-1 text-sm text-muted">You will join as <strong className="capitalize text-fg">{p.role}</strong>{p.role === 'viewer' ? ' (view only)' : ''}.</p>
            <InviteAccept token={token} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">Invitation unavailable</h1>
            <p className="mt-2 text-sm text-muted">{STATUS_TEXT[p?.status ?? 'invalid'] ?? STATUS_TEXT.invalid}</p>
          </>
        )}
      </div>
    </AuthShell>
  );
}
