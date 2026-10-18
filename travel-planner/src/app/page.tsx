import Link from 'next/link';
import { CalendarDays, CheckCircle2, Map, Users, Wallet, Zap } from 'lucide-react';
import { Logo } from '@/components/auth-shell';
import { ThemeToggle } from '@/components/theme-toggle';
import { LinkButton } from '@/components/ui';
import { getUser } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/env';

const features = [
  { icon: Zap, title: 'One live itinerary', text: 'Day-by-day plans with times, places, tickets and notes. When someone edits, everyone sees it within seconds.' },
  { icon: Users, title: 'Invite your people', text: 'Share a link or invite by e-mail. Owners, editors and viewers each get exactly the access you choose.' },
  { icon: CalendarDays, title: 'Calendar your way', text: 'Month, week and day views — plus Google Calendar sync and .ics files for Apple and Outlook.' },
  { icon: Map, title: 'See it on the map', text: 'Every stop pinned and grouped by day, with directions in your favourite maps app.' },
  { icon: Wallet, title: 'Budget and splitting', text: 'Estimates vs. real spending, multiple currencies, and a clear "who owes whom".' },
  { icon: CheckCircle2, title: 'Everything in one place', text: 'Packing lists, to-dos, dietary notes and a full history of who changed what.' },
];

export default async function Landing() {
  const user = isSupabaseConfigured() ? await getUser().catch(() => null) : null;
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          {user ? <LinkButton href="/dashboard" size="sm">Open my trips</LinkButton> : (
            <>
              <LinkButton href="/login" variant="ghost" size="sm">Sign in</LinkButton>
              <LinkButton href="/signup" size="sm">Get started</LinkButton>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="relative isolate overflow-hidden">
          <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-soft/70 to-transparent" />
          <div className="mx-auto max-w-6xl px-5 pb-20 pt-14 text-center sm:pt-24">
            <p className="mx-auto inline-flex rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">Group trip planning, without the group chat chaos</p>
            <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Plan the trip once. <span className="text-brand">Everyone follows along.</span></h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">Build a shared itinerary, invite your travel crew and let each person add the schedule to their own calendar — always up to date.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <LinkButton href={user ? '/trips/new' : '/signup'} size="lg">{user ? 'Plan a new trip' : 'Start planning — it’s free'}</LinkButton>
              <LinkButton href="#how" variant="secondary" size="lg">How it works</LinkButton>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-soft-fg"><Icon className="h-5 w-5" aria-hidden /></span>
                <h2 className="mt-4 font-semibold">{title}</h2>
                <p className="mt-1.5 text-sm text-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-4xl scroll-mt-8 px-5 pb-20">
          <h2 className="text-2xl font-semibold tracking-tight">How sharing and calendars work</h2>
          <ol className="mt-6 space-y-4 text-sm text-muted">
            <li className="rounded-2xl border border-line bg-surface p-5"><strong className="text-fg">1 · Create the trip and invite people.</strong> Everyone you invite sees the same itinerary inside Wanderplan, and changes appear live.</li>
            <li className="rounded-2xl border border-line bg-surface p-5"><strong className="text-fg">2 · Each person chooses how to use their own calendar.</strong> Sharing a trip never gives anyone access to anyone else’s calendar. Every participant decides for themselves: connect Google Calendar, subscribe to a private calendar link (Apple, Outlook, Google), or download an .ics file.</li>
            <li className="rounded-2xl border border-line bg-surface p-5"><strong className="text-fg">3 · Updates keep flowing.</strong> Google sync and subscriptions pick up changes automatically; one-off .ics files are a snapshot. We explain exactly what each option does, right where you set it up.</li>
          </ol>
        </section>
      </main>

      <footer className="border-t border-line py-8 text-center text-sm text-muted">
        <Link href="/" className="font-medium text-fg">Wanderplan</Link> · plan together, travel together
      </footer>
    </div>
  );
}
