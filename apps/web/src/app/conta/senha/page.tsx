'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetch, ApiError } from '../../../utils/api-client';
import { useCurrentRole } from '../../../components/app-shell';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { acknowledgePasswordChange } = useCurrentRole();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        json: { currentPassword, newPassword },
      });
      acknowledgePasswordChange();
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível trocar a senha.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md items-center px-6 py-10">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full space-y-5 rounded-xl border border-border-color bg-bg-surface/70 p-7"
        aria-labelledby="change-password-title"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h1 id="change-password-title" className="text-lg font-bold text-text-primary">
              Troque sua senha
            </h1>
            <p className="text-xs text-text-muted">
              A senha inicial vale só para este primeiro acesso. O restante do HUB fica bloqueado até a troca.
            </p>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <label className="block space-y-1.5 text-xs font-medium text-text-muted">
          Senha atual
          <input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-emerald-500 focus:outline-none"
          />
        </label>

        <label className="block space-y-1.5 text-xs font-medium text-text-muted">
          Nova senha
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-emerald-500 focus:outline-none"
          />
        </label>

        <label className="block space-y-1.5 text-xs font-medium text-text-muted">
          Confirmar nova senha
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-border-color bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-emerald-500 focus:outline-none"
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-emerald-500 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar senha
        </button>
      </form>
    </main>
  );
}
