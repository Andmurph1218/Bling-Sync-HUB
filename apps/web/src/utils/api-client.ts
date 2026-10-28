export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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
  if (!res.ok) {
    throw new ApiError(res.status, body);
  }
  return body as T;
}
