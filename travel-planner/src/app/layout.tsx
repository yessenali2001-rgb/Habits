import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/toast';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Wanderplan — plan trips together', template: '%s · Wanderplan' },
  description: 'Build a day-by-day itinerary with friends, family or colleagues. Everyone sees the same live plan and can add it to their own calendar.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e' };

// Light is the default; only an explicit choice (stored by the toggle) switches to dark. Runs before first paint.
const themeScript = `try{if(localStorage.getItem('wp-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-dvh antialiased"><ToastProvider>{children}</ToastProvider></body>
    </html>
  );
}
