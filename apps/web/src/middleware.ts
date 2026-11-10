import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'bling_hub_sid';

function loginRedirect(request: NextRequest): NextResponse {
  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = `next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(login);
}

function forbiddenRedirect(request: NextRequest): NextResponse {
  const home = request.nextUrl.clone();
  home.pathname = '/';
  home.search = 'erro=403';
  return NextResponse.redirect(home);
}

/** Admin passa em qualquer rota. Os demais papéis só entram no que a regra lista. */
const RULES: Array<{ match: (path: string) => boolean; roles: string[] }> = [
  { match: (path) => path.startsWith('/configuracoes') || path.startsWith('/admin'), roles: ['admin'] },
  {
    match: (path) => path === '/fiscal' || path.startsWith('/fiscal/') || path.startsWith('/auditoria'),
    roles: ['admin', 'fiscal_approver'],
  },
  {
    match: (path) =>
      ['/publicacoes', '/vinculos', '/canais', '/integracoes', '/matching'].some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`)
      ),
    roles: ['admin', 'operator'],
  },
];

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return loginRedirect(request);

  const rule = RULES.find((item) => item.match(request.nextUrl.pathname));
  const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001';
  try {
    const me = await fetch(`${api}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!me.ok) return loginRedirect(request);
    if (!rule) return NextResponse.next();
    const body = (await me.json()) as { user?: { roles?: string[]; permissions?: string[] } };
    const roles = body.user?.roles ?? [];
    const permissions = body.user?.permissions ?? [];
    const path = request.nextUrl.pathname;
    const can = (permission: string) => roles.includes('admin') || permissions.includes(permission);
    if (path.startsWith('/configuracoes')) {
      const needed = path.startsWith('/configuracoes/usuarios')
        ? 'settings:manage_users'
        : path.startsWith('/configuracoes/notificacoes')
          ? 'settings:manage_notifications'
          : path.startsWith('/configuracoes/webhooks')
            ? 'settings:manage_webhooks'
            : path.startsWith('/configuracoes/seguranca')
              ? 'settings:manage_security'
              : path.startsWith('/configuracoes/geral')
                ? 'settings:manage_general'
                : '';
      if (needed ? can(needed) : permissions.some((item) => item.startsWith('settings:manage_')) || roles.includes('admin')) {
        return NextResponse.next();
      }
      return forbiddenRedirect(request);
    }
    if (path.startsWith('/fiscal/ean') && can('fiscal:approve_ean')) return NextResponse.next();
    if (path.startsWith('/fiscal/ncm') && can('fiscal:approve_ncm')) return NextResponse.next();
    if ((path === '/fiscal' || path.startsWith('/fiscal/')) && (can('fiscal:approve_ean') || can('fiscal:approve_ncm'))) return NextResponse.next();
    if (path.startsWith('/auditoria') && can('audit:read')) return NextResponse.next();
    if (roles.includes('admin') || rule.roles.some((role) => roles.includes(role))) return NextResponse.next();
    if (rule.roles.includes('operator') && (can('product:write') || can('push:simulate') || can('push:execute'))) return NextResponse.next();
    return forbiddenRedirect(request);
  } catch {
    return loginRedirect(request);
  }
}

export const config = {
  matcher: [
    '/admin',
    '/admin/:path*',
    '/configuracoes',
    '/configuracoes/:path*',
    '/fiscal',
    '/fiscal/:path*',
    '/auditoria',
    '/auditoria/:path*',
    '/publicacoes',
    '/publicacoes/:path*',
    '/vinculos',
    '/vinculos/:path*',
    '/canais',
    '/canais/:path*',
    '/integracoes',
    '/integracoes/:path*',
    '/matching',
    '/matching/:path*',
  ],
};
