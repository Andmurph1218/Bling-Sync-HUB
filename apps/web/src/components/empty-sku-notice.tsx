import React from 'react';
import { AlertTriangle } from 'lucide-react';

export function isBlankSku(sku: string | null | undefined): boolean {
  return sku == null || sku.trim() === '';
}

export function EmptySkuNotice() {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-200"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      Sem SKU — não sincroniza
    </span>
  );
}
