'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../../utils/api-client';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await apiFetch<{ mustChangePassword?: boolean }>('/auth/login', {
        method: 'POST',
        json: { email, password },
      });
      if (session.mustChangePassword) {
        router.replace('/conta/senha');
        return;
      }
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('/login') ? next : '/');
    } catch (err) {
      const rejectedDefault =
        err instanceof ApiError &&
        err.status === 403 &&
        typeof err.body === 'object' &&
        err.body !== null &&
        'error' in err.body &&
        (err.body as { error: unknown }).error === 'default_password_rejected';
      setError(
        rejectedDefault
          ? 'A senha padrão do bootstrap não é aceita fora do ambiente de desenvolvimento.'
          : err instanceof ApiError && err.status === 401
          ? 'E-mail ou senha inválidos.'
          : 'Não foi possível conectar à API local (http://localhost:3001). Verifique se ela está em execução.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-sm space-y-5 rounded-xl border border-border-color bg-bg-surface/70 p-7 shadow-xl"
        aria-labelledby="login-title"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 id="login-title" className="text-lg font-bold text-text-primary">Bling Sync HUB</h1>
            <p className="text-xs text-text-muted">Acesso ao Centro de Controle Operacional</p>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium text-text-muted">E-mail</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium text-text-muted">Senha</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-emerald-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-emerald-500 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          <span>{submitting ? 'Entrando...' : 'Entrar'}</span>
        </button>

        <p className="text-[11px] leading-relaxed text-text-muted">
          Sessão protegida por cookie HttpOnly. Os papéis (Operador, Revisor Fiscal, Administrador) definem as áreas visíveis e as ações permitidas.
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
