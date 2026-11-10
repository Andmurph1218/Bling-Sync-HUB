'use client';

import React from 'react';
import { IntegrationCard } from './integration-card';

export { IntegrationCard };
export function MinhasConexoes({ children }: { children: React.ReactNode }) {
  return <section aria-label="Minhas conexões">{children}</section>;
}
