'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCurrentRole } from '../app-shell';

const LINKS = [
  { href: '/configuracoes/geral', label: 'Geral', permission: 'settings:manage_general' },
  { href: '/configuracoes/usuarios', label: 'Usuários', permission: 'settings:manage_users' },
  { href: '/configuracoes/notificacoes', label: 'Notificações', permission: 'settings:manage_notifications' },
  { href: '/configuracoes/webhooks', label: 'Webhooks e chaves', permission: 'settings:manage_webhooks' },
  { href: '/configuracoes/seguranca', label: 'Segurança', permission: 'settings:manage_security' },
];

export function SettingsFrame({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { hasPermission } = useCurrentRole();
  const links = LINKS.filter((link) => hasPermission(link.permission));

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="border-b border-border-color pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-text-primary">Centro de governança</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">Permissões, ciclo de vida das contas e regras do tenant.</p>
      </header>
      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <nav aria-label="Seções de configuração" className="flex gap-2 overflow-x-auto md:w-48 md:flex-col">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                  active ? 'bg-bg-surface font-semibold text-text-primary' : 'text-text-muted hover:bg-bg-surface'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Link href="/auditoria/configuracoes" className="rounded-lg px-3 py-2 text-sm text-text-muted hover:bg-bg-surface">
            Auditoria
          </Link>
        </nav>
        <section className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          <p className="mt-1 text-sm text-text-muted">{lede}</p>
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </main>
  );
}

export const fieldClass = 'mt-1 w-full rounded-lg border border-border-color bg-bg-surface px-3 py-2 text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500';
