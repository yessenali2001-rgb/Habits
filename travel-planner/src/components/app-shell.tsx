'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { Bell, LayoutDashboard, LogOut, Plus, Settings } from 'lucide-react';
import { signOut } from '@/app/actions/auth';
import { getRealtimeClient } from '@/lib/supabase/client';
import { Logo } from './auth-shell';
import { ThemeToggle } from './theme-toggle';
import { useToast } from './toast';
import { Avatar } from './ui';

const nav = [
  { href: '/dashboard', label: 'Trips', icon: LayoutDashboard },
  { href: '/trips/new', label: 'New trip', icon: Plus },
  { href: '/notifications', label: 'Alerts', icon: Bell, bell: true },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ user, unread, children }: {
  user: { id: string; name: string; avatar: string | null }; unread: number; children: ReactNode;
}) {
  const path = usePathname();
  const [count, setCount] = useState(unread);
  const { toast } = useToast();
  useEffect(() => setCount(unread), [unread]);

  // new notifications arrive live; RLS guarantees this channel only carries the user's own rows
  useEffect(() => {
    let cancelled = false;
    let stop = () => {};
    void getRealtimeClient().then((supabase) => {
      if (cancelled) return;
      const ch = supabase.channel(`notifications:${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => { setCount((c) => c + 1); toast(String((payload.new as { title?: string }).title ?? 'New notification')); })
        .subscribe();
      stop = () => { void supabase.removeChannel(ch); };
    });
    return () => { cancelled = true; stop(); };
  }, [user.id, toast]);

  const active = (href: string) => (href === '/dashboard' ? path === '/dashboard' || (path.startsWith('/trips') && path !== '/trips/new') : path.startsWith(href));
  const badge = (n: number) => n > 0 && <span className="absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{n > 9 ? '9+' : n}</span>;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface p-4 lg:flex">
        <Logo className="px-2 py-1" />
        <nav aria-label="Main" className="mt-8 flex-1 space-y-1">
          {nav.map(({ href, label, icon: Icon, bell }) => (
            <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}
              className={clsx('relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active(href) ? 'bg-brand-soft text-brand-soft-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
              <span className="relative"><Icon className="h-4.5 w-4.5" aria-hidden />{bell && badge(count)}</span>
              {label === 'Alerts' ? 'Notifications' : label}
            </Link>
          ))}
        </nav>
        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex items-center gap-3 px-1">
            <Avatar name={user.name} src={user.avatar} size={36} />
            <div className="min-w-0"><p className="truncate text-sm font-medium">{user.name}</p></div>
            <ThemeToggle className="ml-auto" />
          </div>
          <form action={signOut}><button className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"><LogOut className="h-4 w-4" aria-hidden />Sign out</button></form>
        </div>
      </aside>

      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-2.5 backdrop-blur lg:hidden">
          <Logo />
          <div className="flex items-center gap-1"><ThemeToggle /><form action={signOut}><button aria-label="Sign out" className="grid h-8 w-8 place-items-center rounded-xl text-muted hover:bg-surface-2"><LogOut className="h-4 w-4" aria-hidden /></button></form></div>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {nav.map(({ href, label, icon: Icon, bell }) => (
          <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}
            className={clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active(href) ? 'text-brand' : 'text-muted')}>
            <span className="relative"><Icon className="h-5 w-5" aria-hidden />{bell && badge(count)}</span>{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
