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

/**
 * A sessão é conferida na API, no mesmo host em que o cookie foi gravado.
 * Sem cookie, ou com sessão inválida, a página /admin nem chega a renderizar.
 */
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return loginRedirect(request);

  const api = process.env.API_INTERNAL_URL || 'http://127.0.0.1:3001';
  try {
    const me = await fetch(`${api}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!me.ok) return loginRedirect(request);
    const body = (await me.json()) as { user?: { roles?: string[] } };
    if (!body.user?.roles?.includes('admin')) return forbiddenRedirect(request);
  } catch {
    return loginRedirect(request);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
