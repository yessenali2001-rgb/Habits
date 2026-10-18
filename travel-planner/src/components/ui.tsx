'use client';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

/* A deliberately small component kit: consistent radii, focus rings, sizes and states across the app. */

const btnBase = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-55 disabled:pointer-events-none select-none whitespace-nowrap';
const btnVariants = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-hover shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:opacity-90',
  soft: 'bg-brand-soft text-brand-soft-fg hover:opacity-90',
};
const btnSizes = { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4 text-sm', lg: 'h-12 px-6 text-base' };
export type ButtonStyle = { variant?: keyof typeof btnVariants; size?: keyof typeof btnSizes; className?: string };
export const buttonClass = ({ variant = 'primary', size = 'md', className }: ButtonStyle = {}) =>
  cn(btnBase, btnVariants[variant], btnSizes[size], className);

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyle & { loading?: boolean }>(
  function Button({ variant, size, className, loading, children, disabled, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} disabled={disabled || loading} className={buttonClass({ variant, size, className })} {...rest}>
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  });

export function LinkButton({ href, children, external, ...style }: ButtonStyle & { href: string; children: ReactNode; external?: boolean }) {
  const cls = buttonClass(style);
  return external
    ? <a href={href} className={cls} target="_blank" rel="noopener noreferrer">{children}</a>
    : <Link href={href} className={cls}>{children}</Link>;
}

const fieldBase = 'w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-60 aria-[invalid=true]:border-danger';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...p }, ref) { return <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...p} />; });
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...p }, ref) { return <textarea ref={ref} className={cn(fieldBase, 'min-h-20 py-2', className)} {...p} />; });
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...p }, ref) { return <select ref={ref} className={cn(fieldBase, 'h-10 pr-8', className)} {...p}>{children}</select>; });

/** Label + control + hint + error, wired together for screen readers. */
export function Field({ label, htmlFor, error, hint, children, className }: {
  label: string; htmlFor: string; error?: string; hint?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p id={`${htmlFor}-hint`} className="text-xs text-muted">{hint}</p>}
      {error && <p id={`${htmlFor}-err`} role="alert" className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-card', className)} {...p}>{children}</div>;
}

const badgeTones = {
  neutral: 'bg-surface-2 text-muted',
  brand: 'bg-brand-soft text-brand-soft-fg',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  ok: 'bg-ok-soft text-ok',
};
export function Badge({ tone = 'neutral', children, className }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', badgeTones[tone], className)}>{children}</span>;
}

// every color keeps white initials at >= 4.5:1 contrast (WCAG AA)
const palette = ['#0f766e', '#2563eb', '#9333ea', '#be185d', '#c2410c', '#4d7c0f', '#0e7490', '#b45309'];
export const colorFor = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};
export function Avatar({ name, src, size = 32, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) };
  return src
    ? <img src={src} alt={name} title={name} referrerPolicy="no-referrer" loading="lazy" style={style} className={cn('rounded-full object-cover ring-2 ring-surface', className)} />
    : <span title={name} aria-label={name} style={{ ...style, background: colorFor(name) }} className={cn('inline-grid place-items-center rounded-full font-semibold text-white ring-2 ring-surface', className)}>{initials}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-label="Loading" className={cn('h-5 w-5 animate-spin text-muted', className)} />;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-brand-soft-fg">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'danger' | 'warn' | 'ok' | 'brand'; children: ReactNode; className?: string }) {
  const tones = { neutral: 'bg-surface-2 text-fg', danger: 'bg-danger-soft text-danger', warn: 'bg-warn-soft text-warn', ok: 'bg-ok-soft text-ok', brand: 'bg-brand-soft text-brand-soft-fg' };
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-xl px-3.5 py-2.5 text-sm', tones[tone], className)}>{children}</div>;
}

/** Accessible modal built on the native <dialog>: focus trapping, ESC and inert background come for free. */
export function Dialog({ open, onClose, title, description, children, wide }: {
  open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="dlg-title"
      className={cn('m-auto w-[calc(100%-1.5rem)] rounded-2xl border border-line bg-surface p-0 shadow-2xl backdrop:bg-black/50', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
          <h2 id="dlg-title" className="text-lg font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          <div className="mt-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id: string }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 text-sm">
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}>
        <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  );
}
