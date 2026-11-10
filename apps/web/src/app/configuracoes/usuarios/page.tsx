'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { MoreVertical, UserPlus } from 'lucide-react';
import { apiFetch } from '../../../utils/api-client';
import { SettingsFrame, fieldClass } from '../../../components/settings/settings-frame';

interface AccessRole {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

interface HubUser {
  id: string;
  name: string;
  email: string;
  active: boolean;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  inviteStatus: 'pending' | 'active';
  roles: Array<{ id: string; slug: string; name: string }>;
  lastAccess: string | null;
}

interface PermissionOption { id: string; label: string }

export default function UsersPage() {
  const [users, setUsers] = useState<HubUser[]>([]);
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionOption[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<HubUser | null>(null);
  const [tab, setTab] = useState<'pessoas' | 'papeis'>('pessoas');
  const [invite, setInvite] = useState({ name: '', email: '', roleIds: [] as string[] });
  const [custom, setCustom] = useState({ name: '', permissions: [] as string[] });

  const load = async () => {
    const [people, catalog, permissionCatalog] = await Promise.all([
      apiFetch<{ users: HubUser[] }>(`/api/admin/users?q=${encodeURIComponent(query)}&role=${encodeURIComponent(roleFilter)}`),
      apiFetch<{ roles: AccessRole[] }>('/api/admin/roles'),
      apiFetch<{ permissions: PermissionOption[] }>('/api/admin/permissions'),
    ]);
    setUsers(people.users);
    setRoles(catalog.roles);
    setPermissions(permissionCatalog.permissions);
    if (invite.roleIds.length === 0) {
      const viewer = catalog.roles.find((role) => role.slug === 'viewer');
      if (viewer) setInvite((current) => ({ ...current, roleIds: [viewer.id] }));
    }
  };

  useEffect(() => {
    void load().catch(() => setError('Não foi possível ler os usuários.'));
  }, [query, roleFilter]);

  const leastRole = useMemo(() => roles.find((role) => role.slug === 'viewer'), [roles]);

  const sendInvite = async () => {
    setNotice(null);
    try {
      const created = await apiFetch<{ inviteUrl: string; emailed: boolean }>('/api/admin/users', { method: 'POST', json: invite });
      setInviteOpen(false);
      setNotice(created.emailed
        ? 'Convite enviado por e-mail.'
        : `Convite registrado. O envio de e-mail não está configurado neste ambiente. Copie o link: ${created.inviteUrl}`);
      await load();
    } catch {
      setNotice('Não foi possível convidar. Confira se o e-mail já existe.');
    }
  };

  const saveRoles = async (roleIds: string[]) => {
    if (!roleTarget) return;
    try {
      await apiFetch(`/api/admin/users/${roleTarget.id}/roles`, { method: 'PATCH', json: { roleIds } });
      setRoleTarget(null);
      setNotice('Papéis atualizados e registrados na auditoria.');
      await load();
    } catch {
      setNotice('Não foi possível alterar os papéis. Você não pode tirar o seu próprio acesso de administrador.');
    }
  };

  const deactivate = async (user: HubUser) => {
    setMenuId(null);
    if (!window.confirm(`Desativar a conta de ${user.name}? O histórico de auditoria permanece.`)) return;
    try {
      await apiFetch(`/api/admin/users/${user.id}/deactivate`, { method: 'POST' });
      setNotice('Conta desativada.');
      await load();
    } catch {
      setNotice('Não foi possível desativar. Você não pode desativar a própria conta.');
    }
  };

  const resetPassword = async (user: HubUser) => {
    setMenuId(null);
    try {
      const result = await apiFetch<{ resetUrl: string; emailed: boolean }>(`/api/admin/users/${user.id}/reset-password`, { method: 'POST' });
      setNotice(result.emailed ? `E-mail de redefinição enviado para ${user.email}.` : `Link de redefinição, mostrado uma vez: ${result.resetUrl}`);
    } catch {
      setNotice('Não foi possível redefinir a senha.');
    }
  };

  const createRole = async () => {
    try {
      await apiFetch('/api/admin/roles', { method: 'POST', json: custom });
      setCustom({ name: '', permissions: [] });
      setNotice('Papel customizado criado.');
      await load();
    } catch {
      setNotice('Não foi possível criar o papel.');
    }
  };

  const toggle = (list: string[], value: string) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return (
    <SettingsFrame title="Usuários" lede="Convide com o menor privilégio e desative contas sem apagar o histórico.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={() => setTab('pessoas')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === 'pessoas' ? 'bg-bg-surface text-text-primary' : 'text-text-muted'}`}>Pessoas</button>
          <button type="button" onClick={() => setTab('papeis')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${tab === 'papeis' ? 'bg-bg-surface text-text-primary' : 'text-text-muted'}`}>Papéis</button>
        </div>
        {tab === 'pessoas' && (
          <button type="button" onClick={() => setInviteOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">
            <UserPlus className="h-3.5 w-3.5" />
            Convidar usuário
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-rose-600">{error}</p>}
      {notice && <p role="status" className="mb-3 break-all text-sm text-text-muted">{notice}</p>}

      {tab === 'pessoas' ? (
        <div onClick={() => setMenuId(null)}>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou e-mail" className={fieldClass} />
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={fieldClass}>
              <option value="">Qualquer papel</option>
              {roles.map((role) => <option key={role.id} value={role.slug}>{role.name}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border-color bg-bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
                <tr className="h-10">
                  <th className="px-4 font-semibold">Nome</th>
                  <th className="px-3 font-semibold">E-mail</th>
                  <th className="px-3 font-semibold">Papéis</th>
                  <th className="px-3 font-semibold">Convite</th>
                  <th className="px-3 font-semibold">MFA</th>
                  <th className="px-4 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border-color">
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{user.name}</p>
                      <p className="text-[11px] text-text-muted">{user.active ? 'Conta ativa' : 'Conta desativada'}</p>
                    </td>
                    <td className="px-3 py-3 text-text-muted">{user.email}</td>
                    <td className="px-3 py-3 text-xs">{user.roles.map((role) => role.name).join(', ') || 'Sem papel'}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.inviteStatus === 'active' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200'}`}>
                        {user.inviteStatus === 'active' ? 'Ativo' : 'Pendente'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {user.mfaRequired && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${user.mfaEnabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200'}`}>
                          {user.mfaEnabled ? 'MFA ativo' : 'MFA obrigatório'}
                        </span>
                      )}
                    </td>
                    <td className="relative px-4 py-3 text-right">
                      <button type="button" aria-label={`Ações de ${user.name}`} aria-expanded={menuId === user.id} className="rounded-md p-1.5 text-text-muted hover:bg-bg-base" onClick={(event) => { event.stopPropagation(); setMenuId((current) => current === user.id ? null : user.id); }}>
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {menuId === user.id && (
                        <div className="absolute right-4 z-10 mt-1 w-44 rounded-lg border border-border-color bg-bg-base py-1 text-left text-xs shadow-lg" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="block w-full px-3 py-2 text-left hover:bg-bg-surface" onClick={() => { setMenuId(null); setRoleTarget(user); }}>Editar papéis</button>
                          <button type="button" className="block w-full px-3 py-2 text-left hover:bg-bg-surface" onClick={() => void resetPassword(user)}>Redefinir senha</button>
                          <button type="button" className="block w-full px-3 py-2 text-left text-rose-600 hover:bg-bg-surface disabled:opacity-40" disabled={!user.active} onClick={() => void deactivate(user)}>Desativar conta</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-sm text-text-muted">Nenhuma pessoa encontrada para este filtro.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
          <ul className="space-y-3">
            {roles.map((role) => (
              <li key={role.id} className="rounded-lg border border-border-color px-3 py-3">
                <p className="text-sm font-semibold text-text-primary">{role.name}{role.isSystem ? ' · sistema' : ''}</p>
                <p className="mt-1 text-xs text-text-muted">{role.permissions.join(', ')}</p>
              </li>
            ))}
          </ul>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void createRole(); }}>
            <h3 className="text-sm font-semibold text-text-primary">Papel customizado</h3>
            <input required value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} placeholder="Ex.: Aprovador de EAN" className={fieldClass} />
            <div className="max-h-64 space-y-1 overflow-auto">
              {permissions.map((permission) => (
                <label key={permission.id} className="flex items-center gap-2 text-xs text-text-primary">
                  <input type="checkbox" checked={custom.permissions.includes(permission.id)} onChange={() => setCustom({ ...custom, permissions: toggle(custom.permissions, permission.id) })} />
                  {permission.label}
                </label>
              ))}
            </div>
            <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white">Criar papel</button>
          </form>
        </div>
      )}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Convidar usuário">
          <form className="w-full max-w-md rounded-xl border border-border-color bg-bg-base p-5" onSubmit={(event) => { event.preventDefault(); void sendInvite(); }}>
            <h2 className="text-base font-semibold text-text-primary">Convidar usuário</h2>
            <p className="mt-1 text-xs text-text-muted">Comece com o menor privilégio. O convite chega com um link para definir a senha.</p>
            <label className="mt-4 block text-xs text-text-muted">E-mail
              <input required type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} className={fieldClass} />
            </label>
            <label className="mt-3 block text-xs text-text-muted">Nome
              <input value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} className={fieldClass} />
            </label>
            <fieldset className="mt-3 space-y-1">
              <legend className="text-xs text-text-muted">Papéis</legend>
              {roles.map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={invite.roleIds.includes(role.id)} onChange={() => setInvite({ ...invite, roleIds: toggle(invite.roleIds, role.id) })} />
                  {role.name}{role.id === leastRole?.id ? ' · recomendado' : ''}
                </label>
              ))}
            </fieldset>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setInviteOpen(false)} className="rounded-lg border border-border-color px-3 py-1.5 text-xs">Cancelar</button>
              <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Enviar convite</button>
            </div>
          </form>
        </div>
      )}

      {roleTarget && (
        <RoleEditor user={roleTarget} roles={roles} onClose={() => setRoleTarget(null)} onSave={saveRoles} />
      )}
    </SettingsFrame>
  );
}

function RoleEditor({
  user,
  roles,
  onClose,
  onSave,
}: {
  user: HubUser;
  roles: AccessRole[];
  onClose: () => void;
  onSave: (roleIds: string[]) => void;
}) {
  const [selected, setSelected] = useState(user.roles.map((role) => role.id));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Editar papéis">
      <form className="w-full max-w-sm rounded-xl border border-border-color bg-bg-base p-5" onSubmit={(event) => { event.preventDefault(); onSave(selected); }}>
        <h2 className="text-base font-semibold text-text-primary">Papéis de {user.name}</h2>
        <div className="mt-4 space-y-2">
          {roles.map((role) => (
            <label key={role.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(role.id)} onChange={() => setSelected((current) => current.includes(role.id) ? current.filter((id) => id !== role.id) : [...current, role.id])} />
              {role.name}
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs text-text-muted underline">Cancelar</button>
          <button type="submit" className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white">Salvar</button>
        </div>
      </form>
    </div>
  );
}
