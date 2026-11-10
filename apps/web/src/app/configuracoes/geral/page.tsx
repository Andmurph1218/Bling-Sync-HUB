'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../utils/api-client';
import { SettingsFrame, fieldClass } from '../../../components/settings/settings-frame';

interface Settings {
  company_name: string;
  timezone: string;
  currency: string;
}

export default function GeneralSettingsPage() {
  const [form, setForm] = useState<Settings>({ company_name: '', timezone: 'America/Sao_Paulo', currency: 'BRL' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ settings: Settings }>('/api/admin/settings')
      .then((payload) => setForm({
        company_name: payload.settings.company_name,
        timezone: payload.settings.timezone,
        currency: payload.settings.currency,
      }))
      .catch(() => setError('Não foi possível ler as configurações gerais.'));
  }, []);

  const save = async () => {
    setNotice(null);
    try {
      await apiFetch('/api/admin/settings?section=general', { method: 'PUT', json: form });
      setNotice('Configuração geral salva.');
    } catch {
      setNotice('Não foi possível salvar.');
    }
  };

  return (
    <SettingsFrame title="Geral" lede="Identidade do tenant usada em relatórios e carimbos de data.">
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <form className="max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="block text-xs text-text-muted">Nome da empresa
          <input required value={form.company_name} onChange={(event) => setForm({ ...form, company_name: event.target.value })} className={fieldClass} />
        </label>
        <label className="block text-xs text-text-muted">Fuso horário
          <input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} className={fieldClass} />
        </label>
        <label className="block text-xs text-text-muted">Moeda
          <input required maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} className={fieldClass} />
        </label>
        <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">Salvar</button>
        {notice && <p role="status" className="text-sm text-text-muted">{notice}</p>}
      </form>
    </SettingsFrame>
  );
}
