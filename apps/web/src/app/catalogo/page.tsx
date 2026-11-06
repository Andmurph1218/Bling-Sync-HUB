'use client';

import React, { Suspense } from 'react';
import { CatalogScreen } from '../../components/catalog-screen';

export default function CatalogoPage() {
  return (
    <Suspense fallback={<main className="px-6 py-8 text-sm text-text-muted">Lendo o catálogo...</main>}>
      <CatalogScreen />
    </Suspense>
  );
}
