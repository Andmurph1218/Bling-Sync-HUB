'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Boxes,
  GitCompare,
  ClipboardList,
  Send,
  TrendingUp,
  Sliders,
  History,
  Barcode,
  FileCheck2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Radio,
  LogOut,
  Loader2,
} from 'lucide-react';
import { apiFetch } from '../utils/api-client';

export type UserRole = 'admin' | 'fiscal_approver' | 'operator';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  /** Papel principal usado para exibição (admin > fiscal_approver > operator). */
  role: UserRole;
  roleLabel: string;
  initials: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  fiscal_approver: 'Revisor Fiscal',
  operator: 'Operador',
};

function toSessionUser(raw: { id: string; name: string; email: string; roles: UserRole[] }): SessionUser {
  const role: UserRole = raw.roles.includes('admin')
    ? 'admin'
    : raw.roles.includes('fiscal_approver')
    ? 'fiscal_approver'
    : 'operator';
  const initials =
    raw.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || 'US';
  return { ...raw, role, roleLabel: raw.roles.map((r) => ROLE_LABELS[r]).join(' · '), initials };
}

interface RoleContextValue {
  currentUser: SessionUser;
  hasRole: (...roles: UserRole[]) => boolean;
}

const ANONYMOUS: SessionUser = {
  id: '',
  name: 'Visitante',
  email: '',
  roles: [],
  role: 'operator',
  roleLabel: 'Sem sessão',
  initials: '--',
};

const RoleContext = createContext<RoleContextValue>({
  currentUser: ANONYMOUS,
  hasRole: () => false,
});

export function useCurrentRole() {
  return useContext(RoleContext);
}

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: UserRole[];
  isSubItem?: boolean;
}

/**
 * Arquitetura de Navegação nas 8 Áreas Operacionais (Seção 4 de docs/bling_sync_hub_evolucao_dashboard.md),
 * filtrada pelos papéis reais da sessão.
 */
const NAV_ITEMS: NavItem[] = [
  { href: '/', label: '1. Visão Geral', shortLabel: 'Início', icon: LayoutDashboard, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { href: '/catalogo', label: '2. Catálogo de Produtos', shortLabel: 'Catálogo', icon: Boxes, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { href: '/matching', label: '3. Correspondências', shortLabel: 'Vínculos', icon: GitCompare, allowedRoles: ['admin', 'operator'] },
  { href: '/pendencias', label: '4. Central de Pendências', shortLabel: 'Pendências', icon: ClipboardList, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { href: '/fiscal/ean', label: '↳ Fiscal · EAN (GTIN)', shortLabel: 'EAN', icon: Barcode, allowedRoles: ['admin', 'fiscal_approver'], isSubItem: true },
  { href: '/fiscal/ncm', label: '↳ Fiscal · NCM (Dupla)', shortLabel: 'NCM', icon: FileCheck2, allowedRoles: ['admin', 'fiscal_approver'], isSubItem: true },
  { href: '/publicacoes', label: '5. Publicações e Sinc.', shortLabel: 'Publicar', icon: Send, allowedRoles: ['admin', 'operator'] },
  { href: '/qualidade-margem', label: '6. Qualidade e Margem', shortLabel: 'Margem', icon: TrendingUp, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { href: '/canais', label: '7. Canais e Regras', shortLabel: 'Canais', icon: Sliders, allowedRoles: ['admin'] },
  { href: '/auditoria', label: '8. Auditoria e Histórico', shortLabel: 'Auditoria', icon: History, allowedRoles: ['admin', 'fiscal_approver'] },
];

interface OauthRow {
  provider: string;
  expires_at: string;
}

const CHANNEL_META: Array<{ provider: string; name: string; detail: string }> = [
  { provider: 'bling', name: 'Bling ERP v3', detail: 'Fonte soberana' },
  { provider: 'mercadolivre', name: 'Mercado Livre', detail: 'JHS SHOPPING' },
  { provider: 'nuvemshop', name: 'Nuvemshop', detail: 'Loja 6667412' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [oauthRows, setOauthRows] = useState<OauthRow[] | null>(null);

  const isLoginPage = pathname === '/login';

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    void (async () => {
      try {
        const me = await apiFetch<{ user: { id: string; name: string; email: string; roles: UserRole[] } }>('/auth/me');
        if (cancelled) return;
        setUser(toSessionUser(me.user));
        try {
          const state = await apiFetch<{ channels: { oauth: OauthRow[] } }>('/api/dashboard/operational-state');
          if (!cancelled) setOauthRows(state.channels.oauth);
        } catch {
          if (!cancelled) setOauthRows(null);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, pathname, router]);

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      router.replace('/login');
    }
  };

  if (isLoginPage) {
    return <div className="min-h-screen bg-zinc-950 text-zinc-100">{children}</div>;
  }

  if (checking || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-300">
        <div className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          <span>Verificando sessão...</span>
        </div>
      </div>
    );
  }

  const hasRole = (...roles: UserRole[]) => user.roles.some((r) => roles.includes(r));
  const visibleNavItems = NAV_ITEMS.filter((item) => hasRole(...item.allowedRoles));

  const roleBadgeStyle: Record<UserRole, string> = {
    admin: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    fiscal_approver: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    operator: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  };

  const now = Date.now();
  const channels = CHANNEL_META.map((meta) => {
    if (oauthRows === null) {
      return { ...meta, state: 'unknown' as const, label: 'Estado não verificado' };
    }
    const row = oauthRows.find((o) => o.provider === meta.provider);
    if (!row) return { ...meta, state: 'offline' as const, label: 'Desconectado' };
    const expired = new Date(row.expires_at).getTime() < now;
    return expired
      ? { ...meta, state: 'expired' as const, label: 'Token expirado' }
      : { ...meta, state: 'online' as const, label: 'Conectado' };
  });

  const dotClass = (state: 'online' | 'offline' | 'expired' | 'unknown') =>
    state === 'online' ? 'bg-emerald-500' : state === 'unknown' ? 'bg-zinc-500' : state === 'expired' ? 'bg-amber-500' : 'bg-rose-500';

  return (
    <RoleContext.Provider value={{ currentUser: user, hasRole }}>
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
        <aside
          className={`hidden md:flex flex-col border-r border-zinc-800/80 bg-zinc-900/60 transition-all duration-200 ${
            collapsed ? 'w-20' : 'w-68'
          }`}
        >
          <div className="flex h-16 items-center justify-between border-b border-zinc-800/80 px-4">
            <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              {!collapsed && (
                <div className="leading-tight">
                  <span className="block text-sm font-bold tracking-tight text-white">Bling Sync HUB</span>
                  <span className="block text-[11px] text-zinc-400">Centro Operacional · Shadow</span>
                </div>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
              className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-zinc-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav aria-label="Navegação principal" className="flex-1 space-y-1 overflow-y-auto p-3">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Navegação ({user.roleLabel})
              </p>
            )}
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    item.isSubItem && !collapsed ? 'ml-3 border-l border-zinc-800 pl-3' : ''
                  } ${
                    isActive
                      ? 'border border-zinc-700/80 bg-zinc-800/90 text-white shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-emerald-400' : 'text-zinc-400'}`} />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {!collapsed && (
            <div className="border-t border-zinc-800/80 p-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                  <Radio className="h-3.5 w-3.5" />
                  <span>O Bling manda</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                  Os marketplaces enriquecem. O HUB valida, coordena e registra.
                </p>
              </div>
            </div>
          )}
        </aside>

        <div className="flex flex-1 flex-col min-w-0 pb-16 md:pb-0">
          <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2" aria-label="Estado das integrações">
              <span className="mr-1 text-xs font-medium uppercase tracking-wider text-zinc-500">Integrações:</span>
              {channels.map((ch) => (
                <div
                  key={ch.provider}
                  title={`${ch.detail} · ${ch.label}`}
                  className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/90 px-3 py-1 text-xs"
                >
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    {ch.state === 'online' && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass(ch.state)}`} />
                  </span>
                  <span className="font-medium text-zinc-200">{ch.name}</span>
                  <span className="text-[11px] text-zinc-400">{ch.label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-white" aria-hidden="true">
                  {user.initials}
                </div>
                <div className="hidden sm:block leading-tight">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">{user.name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeStyle[user.role]}`}>
                      {user.roleLabel}
                    </span>
                  </div>
                  <span className="block text-[11px] text-zinc-400">{user.email}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-700 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sair</span>
              </button>
            </div>
          </header>

          <div className="flex-1">{children}</div>
        </div>

        <nav aria-label="Navegação móvel" className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-center justify-around border-t border-zinc-800 bg-zinc-900/95 px-2 py-2 backdrop-blur">
          {visibleNavItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 rounded-md px-3 py-1 text-xs ${
                  isActive ? 'text-emerald-400 font-semibold' : 'text-zinc-400'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </RoleContext.Provider>
  );
}
