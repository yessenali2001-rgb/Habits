import Link from 'next/link';
import type { ReactNode } from 'react';
import { Compass, Calendar, Users } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand text-brand-fg"><Compass className="h-4.5 w-4.5" aria-hidden /></span>
      Wanderplan
    </Link>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo className="text-white" />
        <div className="relative z-10 max-w-md space-y-6">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">One plan. Everyone on the same page.</h2>
          <ul className="space-y-4 text-teal-50/90">
            <li className="flex gap-3"><Users className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />Invite friends by link or e-mail and see changes the moment they happen.</li>
            <li className="flex gap-3"><Calendar className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />Each person adds the schedule to their own Google, Apple or Outlook calendar.</li>
          </ul>
        </div>
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl" />
      </aside>
      <main className="relative flex items-center justify-center px-5 py-12">
        <div className="absolute right-4 top-4 flex items-center gap-2"><ThemeToggle /></div>
        <div className="absolute left-5 top-5 lg:hidden"><Logo /></div>
        {children}
      </main>
    </div>
  );
}
