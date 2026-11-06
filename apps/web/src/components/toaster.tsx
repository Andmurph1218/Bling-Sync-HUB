'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  variant: 'success' | 'warning';
  title: string;
  description?: string;
  reasons?: string[];
  action?: { label: string; href: string };
}

interface ToasterProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function Toaster({ toasts, onDismiss }: ToasterProps) {
  useEffect(() => {
    const timers = toasts
      .filter((toast) => !toast.reasons?.length && !toast.action)
      .map((toast) => setTimeout(() => onDismiss(toast.id), 5000));
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex w-full max-w-md flex-col gap-2.5"
    >
      {toasts.map((toast) => {
        const isSuccess = toast.variant === 'success';
        return (
          <div
            key={toast.id}
            className={`flex items-start justify-between gap-3 rounded-xl border p-4 shadow-2xl backdrop-blur transition-all ${
              isSuccess
                ? 'border-emerald-500/40 bg-bg-surface/95 text-emerald-200'
                : 'border-amber-500/40 bg-bg-surface/95 text-amber-200'
            }`}
          >
            <div className="flex items-start gap-3">
              {isSuccess ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              )}
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-text-primary">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-text-muted">{toast.description}</p>
                )}
                {toast.reasons && toast.reasons.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-text-primary">
                    {toast.reasons.map((reason, index) => (
                      <li key={`${reason}-${index}`}>{reason}</li>
                    ))}
                  </ul>
                )}
                {toast.action && (
                  <Link
                    href={toast.action.href}
                    className="mt-3 inline-flex rounded-lg bg-amber-400 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-300"
                  >
                    {toast.action.label}
                  </Link>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded p-1 text-text-muted hover:bg-bg-surface hover:text-text-primary"
              aria-label="Fechar notificação"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
