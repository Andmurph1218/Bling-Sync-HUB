const configuredApi = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');
const localApi = configuredApi === '' || configuredApi.includes('localhost') || configuredApi.includes('127.0.0.1');

/**
 * No navegador local a API é chamada no mesmo host do Next (rewrite).
 * Assim o cookie de sessão nasce no host da página e o middleware de /admin consegue lê-lo.
 * Em produção o endereço público continua valendo quando não é localhost.
 */
export const API_BASE_URL = typeof window === 'undefined' || !localApi
  ? configuredApi || 'http://127.0.0.1:3001'
  : '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${status}`
    );
  }
}

function redirectToLogin(): void {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
}

/**
 * Cliente HTTP do Dashboard: sempre envia o cookie de sessão HttpOnly da API
 * e redireciona para /login quando a sessão está ausente ou expirada.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: 'no-store',
    credentials: 'include',
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
    redirectToLogin();
  }
  if (
    res.status === 403 &&
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    (body as { error: unknown }).error === 'password_change_required' &&
    typeof window !== 'undefined' &&
    !window.location.pathname.startsWith('/conta/senha')
  ) {
    window.location.href = '/conta/senha';
  }
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}
