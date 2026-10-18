'use client';
import { useState, useTransition } from 'react';
import { acceptInviteByToken } from '@/app/actions/invites';
import { Alert, Button } from './ui';

export function InviteAccept({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-6 space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <Button size="lg" className="w-full" loading={pending} onClick={() => start(async () => {
        const r = await acceptInviteByToken(token);
        if (r && !r.ok) setError(r.error);
      })}>Join this trip</Button>
    </div>
  );
}
