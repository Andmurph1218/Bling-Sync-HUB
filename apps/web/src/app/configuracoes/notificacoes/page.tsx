'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../utils/api-client';
import { SettingsFrame, fieldClass } from '../../../components/settings/settings-frame';

interface Alerts {
  notify_email: string;
  notify_webhook_url: string;
  alert_sync_failure: boolean;
  alert_token_expiring: boolean;
  alert_fiscal_block: boolean;
}

const EVENTS: Array<{ key: keyof Alerts; label: string }> = [
  { key: 'alert_sync_failure', label: 'Falha de sincronização' },
  { key: 'alert_token_expiring', label: 'Token prestes a expirar' },
  { key: 'alert_fiscal_block', label: 'Novo bloqueio fiscal' },
];

export default function NotificationSettingsPage() {
  const [form, setForm] = useState<Alerts>({
    notify_email: '',
    notify_webhook_url: '',
    alert_sync_failure: true,
    alert_token_expiring: true,
    alert_fiscal_block: true,
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void apiFetch<{ settings: Alerts }>('/api/admin/settings').then((payload) => setForm({
      notify_email: payload.settings.notify_email,
      notify_webhook_url: payload.settings.notify_webhook_url,
      alert_sync_failure: payload.settings.alert_sync_failure,
      alert_token_expiring: payload.settings.alert_token_expiring,
      alert_fiscal_block: payload.settings.alert_fiscal_block,
    })).catch(() => setNotice('Não foi possível ler as notificações.'));
  }, []);

  const save = async () => {
    try {
      await apiFetch('/api/admin/settings?section=notifications', { method: 'PUT', json: form });
      setNotice('Alertas salvos. O envio usa o e-mail e o webhook informados.');
    } catch {
      setNotice('Não foi possível salvar os alertas.');
    }
  };

  return (
    <SettingsFrame title="Notificações" lede="Quem deve ser avisado quando a operação sair do esperado.">
      <form className="max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="block text-xs text-text-muted">E-mail dos alertas
          <input type="email" value={form.notify_email} onChange={(event) => setForm({ ...form, notify_email: event.target.value })} className={fieldClass} />
        </label>
        <label className="block text-xs text-text-muted">Webhook de saída
          <input value={form.notify_webhook_url} onChange={(event) => setForm({ ...form, notify_webhook_url: event.target.value })} placeholder="https://" className={fieldClass} />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs text-text-muted">Eventos</legend>
          {EVENTS.map((event) => (
            <label key={event.key} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={Boolean(form[event.key])}
                onChange={(input) => setForm({ ...form, [event.key]: input.target.checked })}
              />
              {event.label}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Salvar alertas</button>
        {notice && <p role="status" className="text-sm text-text-muted">{notice}</p>}
      </form>
    </SettingsFrame>
  );
}
