import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, 'id'>) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; ring: string; iconClass: string }> = {
  success: { icon: CheckCircle2, ring: 'ring-positive/25', iconClass: 'text-positive' },
  error: { icon: XCircle, ring: 'ring-negative/25', iconClass: 'text-negative' },
  warning: { icon: AlertTriangle, ring: 'ring-caution/25', iconClass: 'text-caution' },
  info: { icon: Info, ring: 'ring-brand/25', iconClass: 'text-brand' },
};

const DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => [...current.slice(-3), { ...input, id }]);
      timers.current.set(id, setTimeout(() => dismiss(id), DURATION));
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      dismiss,
      success: (title, description) => toast({ tone: 'success', title, ...(description ? { description } : {}) }),
      error: (title, description) => toast({ tone: 'error', title, ...(description ? { description } : {}) }),
      info: (title, description) => toast({ tone: 'info', title, ...(description ? { description } : {}) }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        `role="status"` with `aria-live="polite"` announces each toast to a
        screen reader without stealing focus from whatever the user is doing.
      */}
      <div
        /*
          Bottom on both breakpoints. A top-right stack sits exactly where the
          header and page actions live, so a success toast would cover the next
          button the user is reaching for. On mobile it clears the bottom
          navigation and the add button.
        */
        className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end sm:px-0"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((item) => {
          const style = TONE_STYLES[item.tone];
          const Icon = style.icon;
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto flex w-full max-w-sm animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-pop ring-1',
                style.ring,
              )}
            >
              <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', style.iconClass)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{item.title}</p>
                {item.description && <p className="mt-0.5 text-sm text-ink-2">{item.description}</p>}
                {item.action && (
                  <button
                    type="button"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                    className="mt-2 text-sm font-semibold text-brand hover:underline"
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="-m-1 rounded-lg p-1 text-ink-3 transition hover:bg-surface-3 hover:text-ink"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
