'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function ProductAliasPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    if (params.id) router.replace(`/catalogo/${params.id}`);
  }, [params.id, router]);
  return <main className="px-6 py-8 text-sm text-text-muted">Abrindo a ficha do produto...</main>;
}
