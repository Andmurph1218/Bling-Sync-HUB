'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Boxes,
  GitCompare,
  ClipboardList,
  TrendingUp,
  Sliders,
  Store,
  Tags,
  History,
  Barcode,
  FileCheck2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  LogOut,
  Loader2,
  Settings,
  Warehouse,
} from 'lucide-react';
import { apiFetch } from '../utils/api-client';
import { ThemeToggle } from './theme-toggle';
import { MERCADO_LIVRE_ACTIVE } from '../config/channels';

export type UserRole = 'admin' | 'fiscal_approver' | 'operator' | 'viewer';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  permissions: string[];
  mfaEnabled: boolean;
  /** Papel principal usado para exibição (admin > fiscal_approver > operator). */
  role: UserRole;
  roleLabel: string;
  initials: string;
  mustChangePassword: boolean;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  fiscal_approver: 'Revisor Fiscal',
  operator: 'Operador',
  viewer: 'Leitura',
};

function toSessionUser(raw: {
  id: string;
  name: string;
  email: string;
  roles: UserRole[];
  permissions?: string[];
  mfaEnabled?: boolean;
  mustChangePassword?: boolean;
}): SessionUser {
  const role: UserRole = raw.roles.includes('admin')
    ? 'admin'
    : raw.roles.includes('fiscal_approver')
    ? 'fiscal_approver'
    : raw.roles.includes('operator')
    ? 'operator'
    : 'viewer';
  const initials =
    raw.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || 'US';
  return {
    ...raw,
    role,
    permissions: raw.permissions ?? [],
    mfaEnabled: raw.mfaEnabled === true,
    roleLabel: raw.roles.map((r) => ROLE_LABELS[r]).join(' · '),
    initials,
    mustChangePassword: raw.mustChangePassword === true,
  };
}

interface RoleContextValue {
  currentUser: SessionUser;
  hasRole: (...roles: UserRole[]) => boolean;
  hasPermission: (permission: string) => boolean;
  acknowledgePasswordChange: () => void;
}

const ANONYMOUS: SessionUser = {
  id: '',
  name: 'Visitante',
  email: '',
  roles: [],
  permissions: [],
  mfaEnabled: false,
  role: 'operator',
  roleLabel: 'Sem sessão',
  initials: '--',
  mustChangePassword: false,
};

const RoleContext = createContext<RoleContextValue>({
  currentUser: ANONYMOUS,
  hasRole: () => false,
  hasPermission: () => false,
  acknowledgePasswordChange: () => undefined,
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
  permission?: string;
  anyPermission?: string[];
  isSubItem?: boolean;
  group: 'operacao' | 'integracoes' | 'qualidade' | 'sistema';
}

const NAV_GROUPS: Array<{ id: NavItem['group']; label: string }> = [
  { id: 'operacao', label: 'Operação' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'qualidade', label: 'Qualidade de Dados' },
  { id: 'sistema', label: 'Sistema' },
];

const NAV_ITEMS: NavItem[] = [
  { group: 'operacao', href: '/', label: 'Início', shortLabel: 'Início', icon: LayoutDashboard, allowedRoles: ['admin', 'fiscal_approver', 'operator', 'viewer'] },
  { group: 'operacao', href: '/catalogo', label: 'Catálogo', shortLabel: 'Catálogo', icon: Boxes, allowedRoles: ['admin', 'fiscal_approver', 'operator', 'viewer'] },
  { group: 'operacao', href: '/completude', label: 'Completude', shortLabel: 'Completude', icon: ClipboardList, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { group: 'operacao', href: '/problemas', label: 'Problemas', shortLabel: 'Problemas', icon: AlertTriangle, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { group: 'integracoes', href: '/canais', label: 'Canais', shortLabel: 'Canais', icon: Sliders, allowedRoles: ['admin', 'operator'] },
  { group: 'integracoes', href: '/canais/depositos', label: 'Depósitos', shortLabel: 'Depósitos', icon: Warehouse, allowedRoles: ['admin', 'operator'], isSubItem: true },
  { group: 'integracoes', href: '/vinculos', label: 'Vínculos', shortLabel: 'Vínculos', icon: GitCompare, allowedRoles: ['admin', 'operator'] },
  { group: 'integracoes', href: '/admin/integracoes', label: 'Loja de Apps', shortLabel: 'Loja', icon: Store, allowedRoles: ['admin'] },
  { group: 'qualidade', href: '/atributos', label: 'Atributos', shortLabel: 'Atributos', icon: Tags, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { group: 'qualidade', href: '/fiscal', label: 'Fiscal', shortLabel: 'Fiscal', icon: FileCheck2, allowedRoles: ['admin', 'fiscal_approver'], anyPermission: ['fiscal:approve_ean', 'fiscal:approve_ncm'] },
  { group: 'qualidade', href: '/fiscal/ean', label: 'Código de barras', shortLabel: 'EAN', icon: Barcode, allowedRoles: ['admin', 'fiscal_approver'], permission: 'fiscal:approve_ean', isSubItem: true },
  { group: 'qualidade', href: '/fiscal/ncm', label: 'Classificação fiscal', shortLabel: 'NCM', icon: FileCheck2, allowedRoles: ['admin', 'fiscal_approver'], permission: 'fiscal:approve_ncm', isSubItem: true },
  { group: 'qualidade', href: '/admin/imports', label: 'Importações', shortLabel: 'Imports', icon: ClipboardList, allowedRoles: ['admin'] },
  { group: 'qualidade', href: '/qualidade-margem', label: 'Saúde e margem', shortLabel: 'Margem', icon: TrendingUp, allowedRoles: ['admin', 'fiscal_approver', 'operator'] },
  { group: 'sistema', href: '/auditoria', label: 'Auditoria', shortLabel: 'Auditoria', icon: History, allowedRoles: ['admin', 'fiscal_approver'], permission: 'audit:read' },
  { group: 'sistema', href: '/configuracoes', label: 'Configurações', shortLabel: 'Config.', icon: Settings, allowedRoles: ['admin'], anyPermission: ['settings:manage_general', 'settings:manage_users', 'settings:manage_notifications', 'settings:manage_webhooks', 'settings:manage_security'] },
  { group: 'sistema', href: '/configuracoes/geral', label: 'Geral', shortLabel: 'Geral', icon: Settings, allowedRoles: ['admin'], permission: 'settings:manage_general', isSubItem: true },
  { group: 'sistema', href: '/configuracoes/usuarios', label: 'Usuários', shortLabel: 'Usuários', icon: Settings, allowedRoles: ['admin'], permission: 'settings:manage_users', isSubItem: true },
  { group: 'sistema', href: '/configuracoes/notificacoes', label: 'Notificações', shortLabel: 'Alertas', icon: Settings, allowedRoles: ['admin'], permission: 'settings:manage_notifications', isSubItem: true },
  { group: 'sistema', href: '/configuracoes/webhooks', label: 'Webhooks e chaves', shortLabel: 'Chaves', icon: Settings, allowedRoles: ['admin'], permission: 'settings:manage_webhooks', isSubItem: true },
  { group: 'sistema', href: '/configuracoes/seguranca', label: 'Segurança', shortLabel: 'Segurança', icon: Settings, allowedRoles: ['admin'], permission: 'settings:manage_security', isSubItem: true },
];

interface OauthRow {
  provider: string;
  expires_at: string;
  has_refresh?: boolean | string;
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

  const isLoginPage = pathname === '/login' || pathname.startsWith('/convite');

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    void (async () => {
      try {
        const me = await apiFetch<{ user: { id: string; name: string; email: string; roles: UserRole[]; permissions?: string[]; mfaEnabled?: boolean; mustChangePassword?: boolean } }>('/auth/me');
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

  const acknowledgePasswordChange = () => {
    setUser((current) => (current ? { ...current, mustChangePassword: false } : current));
  };

  useEffect(() => {
    if (checking || !user) return;
    if (user.mustChangePassword && pathname !== '/conta/senha') {
      router.replace('/conta/senha');
      return;
    }
    if (!user.mustChangePassword && pathname === '/conta/senha') {
      router.replace('/');
    }
  }, [checking, pathname, router, user]);

  const handleLogout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      router.replace('/login');
    }
  };

  if (isLoginPage) {
    return (
      <div className="relative min-h-screen bg-bg-base text-text-primary">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggle />
        </div>
        {children}
      </div>
    );
  }

  if (checking || !user || (user.mustChangePassword && pathname !== '/conta/senha')) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base text-text-muted">
        <div className="flex items-center gap-2 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          <span>Verificando sessão...</span>
        </div>
      </div>
    );
  }

  const hasRole = (...roles: UserRole[]) => user.roles.includes('admin') || user.roles.some((r) => roles.includes(r));
  const hasPermission = (permission: string) =>
    user.roles.includes('admin') || user.permissions.includes(permission) || (permission.endsWith(':read') && user.permissions.includes('*:read'));
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.anyPermission) return item.anyPermission.some((permission) => hasPermission(permission));
    if (item.permission) return hasPermission(item.permission);
    return hasRole(...item.allowedRoles);
  });

  const roleBadgeStyle: Record<UserRole, string> = {
    admin: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    fiscal_approver: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    operator: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
    viewer: 'border-border-color bg-bg-surface text-text-muted',
  };

  const now = Date.now();
  const channels = CHANNEL_META.flatMap((meta) => {
    if (meta.provider === 'mercadolivre' && !MERCADO_LIVRE_ACTIVE) return [];
    if (oauthRows === null) return [];
    const row = oauthRows.find((o) => o.provider === meta.provider);
    if (!row) return [];
    const refresh = row.has_refresh;
    const canRenew =
      row.provider === 'nuvemshop' ||
      (row.provider === 'bling' && (refresh === true || refresh === 't' || refresh === 'true'));
    const expired = new Date(row.expires_at).getTime() < now && !canRenew;
    if (expired) return [];
    return [{ ...meta, state: 'online' as const, label: 'Conectado' }];
  });

  return (
    <RoleContext.Provider value={{ currentUser: user, hasRole, hasPermission, acknowledgePasswordChange }}>
      <div className="flex min-h-screen bg-bg-base text-text-primary">
        <aside
          className={`hidden md:flex flex-col border-r border-border-color/80 bg-bg-surface/60 transition-all duration-200 ${
            collapsed ? 'w-20' : 'w-68'
          }`}
        >
          <div className="flex h-16 items-center justify-between border-b border-border-color/80 px-4">
            <Link href="/" className="flex items-center gap-2.5 overflow-hidden">
              <img src="/brand/jh-logo.jpg" alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
              {!collapsed && (
                <div className="leading-tight">
                  <span className="block text-sm font-bold tracking-tight text-text-primary">JH Sync Hub</span>
                  <span className="block text-[11px] text-text-muted">Centro Operacional · Shadow</span>
                </div>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
              className="rounded-md border border-border-color bg-bg-surface p-1.5 text-text-muted hover:border-border-color hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav aria-label="Navegação principal" className="flex-1 space-y-4 overflow-y-auto p-3">
            {NAV_GROUPS.map((group) => {
              const items = visibleNavItems.filter((item) => item.group === group.id);
              if (items.length === 0) return null;
              return (
                <div key={group.id}>
                  {!collapsed && (
                    <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {group.label}
                    </p>
                  )}
                  <div className="space-y-1">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const isActive = item.href === '/' ? pathname === '/' : pathname === item.href || (item.href !== '/fiscal' && item.href !== '/configuracoes' && pathname.startsWith(item.href));
                      const parentActive = (item.href === '/fiscal' || item.href === '/configuracoes') && pathname.startsWith(item.href);
                      const current = isActive || parentActive;
                      return (
                        <Link
                          key={`${item.href}-${item.label}`}
                          href={item.href}
                          title={collapsed ? item.label : undefined}
                          aria-current={current && pathname === item.href ? 'page' : undefined}
                          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                            item.isSubItem && !collapsed ? 'ml-4' : ''
                          } ${
                            pathname === item.href
                              ? 'bg-bg-base text-text-primary'
                              : 'text-text-muted hover:bg-bg-base/70 hover:text-text-primary'
                          }`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${pathname === item.href ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-muted'}`} />
                          {!collapsed && <span>{item.label}</span>}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex flex-1 flex-col min-w-0 pb-16 md:pb-0">
          <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-border-color/80 bg-bg-base/90 px-6 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2" aria-label="Integrações ativas">
              {channels.map((ch) => (
                <div
                  key={ch.provider}
                  title={`${ch.detail} · ${ch.label}`}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                    ch.provider === 'nuvemshop'
                      ? 'border-sky-600/40 bg-sky-500/10 text-sky-800 dark:text-sky-200'
                      : 'border-emerald-600/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${ch.provider === 'nuvemshop' ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                  <span className="font-medium">{ch.name}</span>
                  <span className="text-[11px] opacity-80">{ch.label}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border-color bg-bg-surface text-xs font-bold text-text-primary" aria-hidden="true">
                  {user.initials}
                </div>
                <div className="hidden sm:block leading-tight">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-primary">{user.name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeStyle[user.role]}`}>
                      {user.roleLabel}
                    </span>
                  </div>
                  <span className="block text-[11px] text-text-muted">{user.email}</span>
                </div>
              </div>
              {hasRole('admin') && (
                <Link
                  href="/admin/integracoes"
                  title="Gerenciar integrações"
                  aria-label="Gerenciar integrações"
                  className="inline-flex items-center justify-center rounded-lg border border-border-color bg-bg-surface p-1.5 text-text-muted hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              )}
              <ThemeToggle />
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-color bg-bg-surface px-2.5 py-1.5 text-xs text-text-muted hover:border-border-color hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sair</span>
              </button>
            </div>
          </header>

          <div className="flex-1">{children}</div>
        </div>

        <nav aria-label="Navegação móvel" className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-center justify-around border-t border-border-color bg-bg-surface/95 px-2 py-2 backdrop-blur">
          {visibleNavItems.filter((item) => item.group === 'operacao').map((item) => {
            const Icon = item.icon;
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 rounded-md px-3 py-1 text-xs ${
                  isActive ? 'text-emerald-400 font-semibold' : 'text-text-muted'
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
