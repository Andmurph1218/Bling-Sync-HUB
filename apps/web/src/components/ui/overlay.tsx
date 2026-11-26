'use client';

import React, { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';

export function useOverlayState(onDismiss: () => void) {
  const [open, setOpen] = useState(true);
  return {
    open,
    onClose: () => setOpen(false),
    onAfterClose: (nextOpen: boolean) => { if (!nextOpen) onDismiss(); },
  };
}

export function MountedOverlay({ onDismiss, children, ...props }: {
  onDismiss: () => void;
  label: string;
  kind?: 'modal' | 'drawer';
  className?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const state = useOverlayState(onDismiss);
  return <Overlay {...state} {...props}>{children(state.onClose)}</Overlay>;
}

export function Overlay({ open, onClose, onAfterClose, label, kind = 'modal', children, className = '' }: {
  open: boolean;
  onClose: () => void;
  onAfterClose: (open: boolean) => void;
  label: string;
  kind?: 'modal' | 'drawer';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }} onOpenChangeComplete={onAfterClose}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-backdrop" />
        <Dialog.Popup aria-label={label} data-kind={kind} className={`ui-dialog ${className}`}>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
