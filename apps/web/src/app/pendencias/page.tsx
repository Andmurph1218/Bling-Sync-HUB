'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PendenciasRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/problemas');
  }, [router]);
  return <main className="px-6 py-8 text-sm text-zinc-300">As pendências agora ficam em Problemas.</main>;
}
