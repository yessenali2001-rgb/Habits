import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';
import { AuthShell } from '@/components/auth-shell';
import { safeNext } from '@/lib/auth';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return <AuthShell><AuthForm mode="signup" next={safeNext(sp.next)} /></AuthShell>;
}
