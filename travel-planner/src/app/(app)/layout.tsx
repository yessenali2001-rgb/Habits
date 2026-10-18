import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { getProfile, requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

// everything signed-in depends on the visitor's session: never prerender it
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  const supabase = await createClient();
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return (
    <AppShell user={{ id: user.id, name: profile.display_name, avatar: profile.avatar_url }} unread={count ?? 0}>
      {children}
    </AppShell>
  );
}
