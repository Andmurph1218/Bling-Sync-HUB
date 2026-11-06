'use client';

import React, { Suspense } from 'react';
import { CatalogScreen } from '../../components/catalog-screen';

export default function CompletudePage() {
  return (
    <Suspense fallback={<main className="px-6 py-8 text-sm text-zinc-300">Lendo a completude...</main>}>
      <CatalogScreen lockedTab="completude" />
    </Suspense>
  );
}
