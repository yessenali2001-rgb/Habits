import { redirect } from 'next/navigation';
import { Logo } from '@/components/auth-shell';
import { Card } from '@/components/ui';
import { isSupabaseConfigured } from '@/lib/env';

export const metadata = { title: 'Setup required' };

export default function SetupPage() {
  if (isSupabaseConfigured()) redirect('/');
  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold tracking-tight">Almost ready — connect a database</h1>
      <p className="mt-2 text-muted">Wanderplan keeps every trip, participant and itinerary in Supabase (PostgreSQL + Auth + Realtime). It has not been connected yet, so there is nothing to show.</p>
      <Card className="mt-6 space-y-3 p-5 text-sm">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Create a free project at <a className="text-brand underline" href="https://supabase.com">supabase.com</a>.</li>
          <li>Run the SQL files in <code>supabase/migrations</code> (SQL editor, or <code>supabase db push</code>).</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.</li>
          <li>Restart the dev server.</li>
        </ol>
        <p className="text-muted">The README has the full walkthrough, including optional Google Calendar sync, e-mail and map settings.</p>
      </Card>
    </main>
  );
}
