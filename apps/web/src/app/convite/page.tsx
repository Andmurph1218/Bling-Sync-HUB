'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../utils/api-client';

function AcceptInvite() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await apiFetch('/auth/invites/accept', { method: 'POST', json: { token, password, name: name || undefined } });
      router.replace('/login');
    } catch {
      setError('O link expirou ou a senha não atende à política.');
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form className="w-full max-w-sm space-y-4 rounded-xl border border-border-color bg-bg-surface p-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h1 className="text-lg font-bold text-text-primary">Definir senha</h1>
        <p className="text-sm text-text-muted">Aceite o convite ou use o link de redefinição para escolher uma senha.</p>
        <label className="block text-xs text-text-muted">Nome
          <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm" />
        </label>
        <label className="block text-xs text-text-muted">Nova senha
          <input required type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm" />
        </label>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Salvar senha</button>
      </form>
    </main>
  );
}

export default function InvitePage() {
  return <Suspense><AcceptInvite /></Suspense>;
}
