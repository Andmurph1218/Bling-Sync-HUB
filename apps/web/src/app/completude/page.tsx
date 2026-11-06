'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../utils/api-client';

interface CompletenessGroup {
  code: string;
  label: string;
  count: number;
  href: string;
}

export default function CompletudePage() {
  const [groups, setGroups] = useState<CompletenessGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ pendencies: CompletenessGroup[] }>('/api/problems')
      .then((payload) => setGroups(payload.pendencies))
      .catch(() => setError('Não foi possível agrupar a completude.'));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold text-white">Completude</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Cada grupo abre o catálogo já filtrado pela pendência.
      </p>
      {error && <p className="mt-4 text-sm text-rose-200" role="alert">{error}</p>}
      {!error && groups.length === 0 && <p className="mt-6 text-sm text-zinc-400">Nenhuma pendência de completude.</p>}
      <ul className="mt-6 space-y-2">
        {groups.map((group) => (
          <li key={group.code}>
            <Link href={group.href} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-white hover:border-zinc-600">
              <span>{group.count} {group.label}</span>
              <span className="text-xs text-sky-300">Abrir no catálogo</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
