import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils/cn';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  /** Show a toast. Returns nothing; auto-dismisses. */
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const KIND_STYLE: Record<ToastKind, { ring: string; icon: React.ReactNode }> = {
  success: { ring: 'border-green-200 bg-green-50 text-green-900', icon: <CheckCircle2 size={16} className="text-green-600" /> },
  error: { ring: 'border-red-200 bg-red-50 text-red-900', icon: <AlertTriangle size={16} className="text-red-600" /> },
  info: { ring: 'border-blue-200 bg-blue-50 text-blue-900', icon: <Info size={16} className="text-blue-600" /> },
};

/**
 * App-wide non-blocking toasts — the replacement for `alert()`.
 * Mount <ToastProvider> once near the app root; call useToast() anywhere.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, kind, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const api: ToastApi = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
    info: (m) => toast(m, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-sm',
              KIND_STYLE[t.kind].ring,
            )}
          >
            <span className="mt-0.5 shrink-0">{KIND_STYLE[t.kind].icon}</span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-current/60 hover:text-current"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fail soft: if a component using toasts is rendered outside the provider
    // (e.g. an isolated test), fall back to console rather than throwing.
    return {
      toast: (m) => console.warn('[toast]', m),
      success: (m) => console.warn('[toast:success]', m),
      error: (m) => console.error('[toast:error]', m),
      info: (m) => console.info('[toast:info]', m),
    };
  }
  return ctx;
}
