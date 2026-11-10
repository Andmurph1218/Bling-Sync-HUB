'use client';

import React from 'react';

export function ExplorarIntegracoes({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Explorar integrações">
      <p className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-950 dark:text-sky-50">
        Precisa de um novo ERP ou marketplace? Conecte novas fontes de dados ao HUB.
      </p>
      {children}
    </section>
  );
}
