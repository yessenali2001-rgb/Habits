'use client';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { signIn, signUp, type AuthState } from '@/app/actions/auth';
import { getBrowserClient } from '@/lib/supabase/client';
import { Alert, Button, Field, Input } from './ui';

export function AuthForm({ mode, next, error }: { mode: 'login' | 'signup'; next: string; error?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === 'login' ? signIn : signUp, null);
  const [tz, setTz] = useState('UTC');
  const [oauthBusy, setOauthBusy] = useState(false);
  useEffect(() => { try { setTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* keep UTC */ } }, []);
  const fe = state?.fieldErrors ?? {};
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';

  async function google() {
    setOauthBusy(true);
    await getBrowserClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="mt-1 text-sm text-muted">
        {mode === 'login' ? 'Sign in to see your trips and the latest itineraries.' : 'Plan once, invite friends, everyone sees the same live plan.'}
      </p>

      <div className="mt-6 space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {state?.error && <Alert tone="danger">{state.error}</Alert>}
        {state?.message && <Alert tone="ok">{state.message}</Alert>}
      </div>

      {googleEnabled && (
        <>
          <Button variant="secondary" className="mt-5 w-full" onClick={google} loading={oauthBusy}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z" /><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.8V6.5H1.4a12 12 0 0 0 0 11l4-3.1z" /><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" /></svg>
            Continue with Google
          </Button>
          <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
        </>
      )}

      <form action={action} className={googleEnabled ? 'space-y-4' : 'mt-5 space-y-4'} noValidate>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="timezone" value={tz} />
        {mode === 'signup' && (
          <Field label="Your name" htmlFor="name" error={fe.name}>
            <Input id="name" name="name" autoComplete="name" required maxLength={80} aria-invalid={!!fe.name} />
          </Field>
        )}
        <Field label="E-mail" htmlFor="email" error={fe.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!fe.email} />
        </Field>
        <Field label="Password" htmlFor="password" error={fe.password} hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
          <Input id="password" name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} aria-invalid={!!fe.password} />
        </Field>
        <Button type="submit" className="w-full" size="lg" loading={pending}>{mode === 'login' ? 'Sign in' : 'Create account'}</Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === 'login' ? 'New to Wanderplan? ' : 'Already have an account? '}
        <Link href={`${mode === 'login' ? '/signup' : '/login'}${next !== '/dashboard' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-brand underline-offset-4 hover:underline">
          {mode === 'login' ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}
