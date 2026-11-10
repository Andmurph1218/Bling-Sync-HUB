'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentRole } from '../../components/app-shell';

const DESTINATIONS = [
  ['settings:manage_general', '/configuracoes/geral'],
  ['settings:manage_users', '/configuracoes/usuarios'],
  ['settings:manage_notifications', '/configuracoes/notificacoes'],
  ['settings:manage_webhooks', '/configuracoes/webhooks'],
  ['settings:manage_security', '/configuracoes/seguranca'],
] as const;

export default function SettingsIndexPage() {
  const router = useRouter();
  const { hasPermission } = useCurrentRole();
  useEffect(() => {
    const target = DESTINATIONS.find(([permission]) => hasPermission(permission));
    router.replace(target?.[1] ?? '/');
  }, [hasPermission, router]);
  return <main className="px-6 py-8 text-sm text-text-muted">Abrindo configurações…</main>;
}
