'use client';
import clsx from 'clsx';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; tone: 'ok' | 'danger' };
const Ctx = createContext<{ toast: (text: string, tone?: Toast['tone']) => void }>({ toast: () => undefined });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'danger' ? 7000 : 3500);
  }, []);
  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'danger' ? 'alert' : 'status'}
            className={clsx('pointer-events-auto max-w-md rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg',
              t.tone === 'danger' ? 'bg-danger text-white' : 'bg-fg text-bg')}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
