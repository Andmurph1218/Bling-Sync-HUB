'use client';

import React, { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { toast, Toaster as SonnerToaster } from 'sonner';

export interface ToastMessage {
  id: string;
  variant: 'success' | 'warning' | 'neutral';
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
  const scope = useId();
  const active = useRef(new Map<string, ToastMessage>());
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const current = new Set(toasts.map((item) => item.id));
    for (const id of active.current.keys()) {
      if (!current.has(id)) {
        toast.dismiss(`${scope}-${id}`);
        active.current.delete(id);
      }
    }
    for (const item of toasts) {
      if (active.current.get(item.id) === item) continue;
      active.current.set(item.id, item);
      const Icon = item.variant === 'success' ? CheckCircle2 : item.variant === 'warning' ? AlertTriangle : Info;
      toast(item.title, {
        id: `${scope}-${item.id}`,
        duration: item.reasons?.length || item.action ? Infinity : 5000,
        icon: <Icon className={`h-5 w-5 ${item.variant === 'success' ? 'text-emerald-700 dark:text-emerald-300' : item.variant === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-text-muted'}`} />,
        description: <>
          {item.description && <p>{item.description}</p>}
          {!!item.reasons?.length && <ul className="mt-2 list-disc space-y-1 pl-4">{item.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul>}
        </>,
        action: item.action ? <Link className="ui-button" href={item.action.href}>{item.action.label}</Link> : undefined,
        onDismiss: () => dismiss.current(item.id),
        onAutoClose: () => dismiss.current(item.id),
      });
    }
  }, [toasts, scope]);

  useEffect(() => () => {
    for (const id of active.current.keys()) toast.dismiss(`${scope}-${id}`);
  }, [scope]);

  return <SonnerToaster position="bottom-right" closeButton gap={8} offset={16} mobileOffset={16} visibleToasts={3}
    toastOptions={{ classNames: { toast: 'hub-toast', title: 'hub-toast-title', description: 'hub-toast-description', closeButton: 'hub-toast-close' } }} />;
}
