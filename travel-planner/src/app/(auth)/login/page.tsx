import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { safeNext } from '@/lib/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return <AuthShell><AuthForm mode="login" next={safeNext(sp.next)} error={sp.error} /></AuthShell>;
}
