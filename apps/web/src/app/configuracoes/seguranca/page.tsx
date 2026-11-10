'use client';

import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../../utils/api-client';
import { useCurrentRole } from '../../../components/app-shell';
import { SettingsFrame, fieldClass } from '../../../components/settings/settings-frame';

export default function SecuritySettingsPage() {
  const { currentUser } = useCurrentRole();
  const [passwordMin, setPasswordMin] = useState(8);
  const [sessionHours, setSessionHours] = useState(12);
  const [allowedIps, setAllowedIps] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const mfaRequired = currentUser.roles.includes('admin') || currentUser.roles.includes('fiscal_approver');

  useEffect(() => {
    void apiFetch<{ settings: { password_min_length: number; session_hours: number; allowed_ips: string } }>('/api/admin/settings')
      .then((payload) => {
        setPasswordMin(payload.settings.password_min_length);
        setSessionHours(payload.settings.session_hours);
        setAllowedIps(payload.settings.allowed_ips);
      })
      .catch(() => setNotice('Não foi possível ler a política de segurança.'));
  }, []);

  const save = async () => {
    try {
      await apiFetch('/api/admin/settings?section=security', {
        method: 'PUT',
        json: { password_min_length: passwordMin, session_hours: sessionHours, allowed_ips: allowedIps },
      });
      setNotice('Política salva. A lista de IPs vazia continua permitindo qualquer origem.');
    } catch {
      setNotice('Não foi possível salvar a política.');
    }
  };

  const startMfa = async () => {
    const payload = await apiFetch<{ secret: string }>('/api/account/mfa/start', { method: 'POST' });
    setSecret(payload.secret);
  };

  const confirmMfa = async () => {
    try {
      await apiFetch('/api/account/mfa/confirm', { method: 'POST', json: { code } });
      setNotice('MFA ativo nesta conta. O próximo login pede o código.');
      setSecret(null);
    } catch {
      setNotice('O código não confere.');
    }
  };

  return (
    <SettingsFrame title="Segurança" lede="Senha, duração da sessão e segundo fator para quem administra ou revisa o fiscal.">
      <form className="max-w-lg space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="block text-xs text-text-muted">Tamanho mínimo da senha
          <input type="number" min={8} max={64} value={passwordMin} onChange={(event) => setPasswordMin(Number(event.target.value))} className={fieldClass} />
        </label>
        <label className="block text-xs text-text-muted">Expiração da sessão (horas)
          <input type="number" min={1} max={168} value={sessionHours} onChange={(event) => setSessionHours(Number(event.target.value))} className={fieldClass} />
        </label>
        <label className="block text-xs text-text-muted">IPs permitidos, um por linha
          <textarea value={allowedIps} onChange={(event) => setAllowedIps(event.target.value)} rows={4} className={fieldClass} />
        </label>
        <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Salvar política</button>
      </form>
      <div className="mt-8 max-w-lg border-t border-border-color pt-6">
        <h3 className="text-sm font-semibold text-text-primary">Segundo fator</h3>
        <p className="mt-1 text-sm text-text-muted">
          {mfaRequired
            ? 'Esta conta exige MFA. Enquanto não estiver ativo, o badge permanece como obrigatório.'
            : 'MFA é obrigatório para Administrador e Revisor Fiscal.'}
          {currentUser.mfaEnabled ? ' O seu MFA já está ativo.' : ''}
        </p>
        <button type="button" onClick={() => void startMfa()} className="mt-3 rounded-lg border border-border-color px-3 py-2 text-xs font-semibold">Gerar segredo</button>
        {secret && (
          <div className="mt-3 space-y-2">
            <p className="break-all font-mono text-xs text-text-primary">{secret}</p>
            <label className="block text-xs text-text-muted">Código do autenticador
              <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" className={fieldClass} />
            </label>
            <button type="button" onClick={() => void confirmMfa()} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Confirmar MFA</button>
          </div>
        )}
        {notice && <p role="status" className="mt-3 text-sm text-text-muted">{notice}</p>}
      </div>
    </SettingsFrame>
  );
}
