'use client';

import React, { createContext, useContext, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  UserCheck,
  Radio,
} from 'lucide-react';

export type UserRole = 'admin' | 'fiscal_approver' | 'operator';

interface RoleUser {
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  initials: string;
}

export const ROLE_USERS: Record<UserRole, RoleUser> = {
  admin: {
    name: 'Admin JHS',
    email: 'admin@blingsync.local',
    role: 'admin',
    roleLabel: 'Administrador',
    initials: 'AD',
  },
  fiscal_approver: {
    name: 'Carla Mendes (Fiscal 1)',
    email: 'fiscal1@blingsync.local',
    role: 'fiscal_approver',
    roleLabel: 'Revisor Fiscal',
    initials: 'CM',
  },
  operator: {
    name: 'Lucas Operação',
    email: 'operador@blingsync.local',
    role: 'operator',
    roleLabel: 'Operador',
    initials: 'LO',
  },
};

interface RoleContextValue {
  currentUser: RoleUser;
  setRole: (role: UserRole) => void;
}

const RoleContext = createContext<RoleContextValue>({
  currentUser: ROLE_USERS.admin,
  setRole: () => undefined,
});

export function useCurrentRole() {
  return useContext(RoleContext);
}

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedRoles: UserRole[];
  isSubItem?: boolean;
}

/**
 * Arquitetura de Navegação nas 8 Áreas Operacionais (Seção 4 de docs/bling_sync_hub_evolucao_dashboard.md)
 * preservando /matching, /fiscal/ean e /fiscal/ncm.
 */
const NAV_ITEMS: NavItem[] = [
  {
    href: '/',
    label: '1. Visão Geral',
    shortLabel: 'Início',
    icon: LayoutDashboard,
    allowedRoles: ['admin', 'fiscal_approver', 'operator'],
  },
  {
    href: '/catalogo',
    label: '2. Catálogo de Produtos',
    shortLabel: 'Catálogo',
    badge: '25',
    icon: Boxes,
    allowedRoles: ['admin', 'fiscal_approver', 'operator'],
  },
  {
    href: '/matching',
    label: '3. Correspondências',
    shortLabel: 'Vínculos',
    badge: '296',
    icon: GitCompare,
    allowedRoles: ['admin', 'operator'],
  },
  {
    href: '/pendencias',
    label: '4. Central de Pendências',
    shortLabel: 'Pendências',
    badge: '302',
    icon: ClipboardList,
    allowedRoles: ['admin', 'fiscal_approver', 'operator'],
  },
  {
    href: '/fiscal/ean',
    label: '↳ Fiscal · EAN (GTIN)',
    shortLabel: 'EAN',
    icon: Barcode,
    allowedRoles: ['admin', 'fiscal_approver'],
    isSubItem: true,
  },
  {
    href: '/fiscal/ncm',
    label: '↳ Fiscal · NCM (Dupla)',
    shortLabel: 'NCM',
    icon: FileCheck2,
    allowedRoles: ['admin', 'fiscal_approver'],
    isSubItem: true,
  },
  {
    href: '/publicacoes',
    label: '5. Publicações e Sinc.',
    shortLabel: 'Publicar',
    icon: Send,
    allowedRoles: ['admin', 'operator'],
  },
  {
    href: '/qualidade-margem',
    label: '6. Qualidade e Margem',
    shortLabel: 'Margem',
    icon: TrendingUp,
    allowedRoles: ['admin', 'fiscal_approver', 'operator'],
  },
  {
    href: '/canais',
    label: '7. Canais e Regras',
    shortLabel: 'Canais',
    icon: Sliders,
    allowedRoles: ['admin'],
  },
  {
    href: '/auditoria',
    label: '8. Auditoria e Histórico',
    shortLabel: 'Auditoria',
    icon: History,
    allowedRoles: ['admin', 'fiscal_approver'],
  },
];

interface ChannelStatus {
  id: string;
  name: string;
  detail: string;
  online: boolean;
}

const CHANNELS: ChannelStatus[] = [
  { id: 'bling', name: 'Bling ERP v3', detail: 'Fonte Soberana · 3 req/s', online: true },
  { id: 'ml', name: 'Mercado Livre', detail: 'JHS SHOPPING (184060242)', online: true },
  { id: 'ns', name: 'Nuvemshop', detail: 'Loja 6667412', online: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<UserRole>('admin');

  const currentUser = ROLE_USERS[role];
  const visibleNavItems = NAV_ITEMS.filter((item) =>
    item.allowedRoles.includes(currentUser.role)
  );

  const roleBadgeStyle: Record<UserRole, string> = {
    admin: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    fiscal_approver: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    operator: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  };

  return (
    <RoleContext.Provider value={{ currentUser, setRole }}>
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
        {/* Sidebar Desktop Retrátil */}
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
                  <span className="block text-sm font-bold tracking-tight text-white">
                    Bling Sync HUB
                  </span>
                  <span className="block text-[11px] text-zinc-400">
                    Centro Operacional · Shadow
                  </span>
                </div>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              title={collapsed ? 'Expandir menu' : 'Recolher menu'}
              className="rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-zinc-700 hover:text-white"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Navegação ({currentUser.roleLabel})
              </p>
            )}
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition ${
                    item.isSubItem && !collapsed ? 'ml-3 border-l border-zinc-800 pl-3' : ''
                  } ${
                    isActive
                      ? 'border border-zinc-700/80 bg-zinc-800/90 text-white shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon
                      className={`h-4 w-4 shrink-0 ${
                        isActive ? 'text-emerald-400' : 'text-zinc-400'
                      }`}
                    />
                    {!collapsed && <span>{item.label}</span>}
                  </span>
                  {!collapsed && item.badge && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isActive
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
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

        {/* Área Principal */}
        <div className="flex flex-1 flex-col min-w-0 pb-16 md:pb-0">
          {/* Header Superior */}
          <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/80 bg-zinc-950/90 px-6 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Integrações:
              </span>
              {CHANNELS.map((ch) => (
                <div
                  key={ch.id}
                  title={ch.detail}
                  className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/90 px-3 py-1 text-xs"
                >
                  <span className="relative flex h-2 w-2">
                    <span
                      className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                        ch.online ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        ch.online ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                  </span>
                  <span className="font-medium text-zinc-200">{ch.name}</span>
                  <span className="hidden lg:inline text-[11px] text-zinc-500">
                    {ch.detail}
                  </span>
                </div>
              ))}
            </div>

            {/* Indicador do Usuário Logado + Seletor RBAC */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 px-2.5 py-1 text-xs text-zinc-400">
                <UserCheck className="h-3.5 w-3.5 text-zinc-400" />
                <label htmlFor="rbac-role-select" className="sr-only">
                  Alternar Papel RBAC
                </label>
                <select
                  id="rbac-role-select"
                  value={currentUser.role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="bg-transparent text-xs font-medium text-zinc-200 focus:outline-none cursor-pointer"
                >
                  <option value="admin" className="bg-zinc-900">
                    Papel: Administrador (Total)
                  </option>
                  <option value="fiscal_approver" className="bg-zinc-900">
                    Papel: Revisor Fiscal (EAN/NCM)
                  </option>
                  <option value="operator" className="bg-zinc-900">
                    Papel: Operador (Catálogo/Vínculos)
                  </option>
                </select>
              </div>

              <div className="flex items-center gap-2.5 pl-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-xs font-bold text-white">
                  {currentUser.initials}
                </div>
                <div className="hidden sm:block leading-tight">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">
                      {currentUser.name}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleBadgeStyle[currentUser.role]}`}
                    >
                      {currentUser.roleLabel}
                    </span>
                  </div>
                  <span className="block text-[11px] text-zinc-400">
                    {currentUser.email}
                  </span>
                </div>
              </div>
            </div>
          </header>

          {/* Conteúdo da Rota */}
          <div className="flex-1">{children}</div>
        </div>

        {/* Menu Inferior Mobile */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden items-center justify-around border-t border-zinc-800 bg-zinc-900/95 px-2 py-2 backdrop-blur">
          {visibleNavItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
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
