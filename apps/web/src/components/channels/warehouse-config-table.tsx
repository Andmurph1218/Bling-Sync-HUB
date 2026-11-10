'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';

export interface WarehouseRow {
  bling_warehouse_id: string;
  name: string;
  role: string;
  include_in_push: boolean;
}

const ROLES = [
  { id: 'unclassified', label: 'Não classificado' },
  { id: 'seller', label: 'Depósito próprio' },
  { id: 'ml_full', label: 'ML Full' },
  { id: 'other', label: 'Outro' },
];

export function WarehouseConfigTable({
  warehouses,
  canEdit,
  onChange,
}: {
  warehouses: WarehouseRow[];
  canEdit: boolean;
  onChange: (warehouse: WarehouseRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border-color text-[11px] uppercase tracking-wide text-text-muted">
          <tr className="h-10">
            <th className="px-1 py-2 font-semibold">
              <span className="inline-flex items-center gap-1">
                ID no Bling
                <span title="Identificador interno do depósito no ERP. O HUB não inventa esse código.">
                  <HelpCircle className="h-3.5 w-3.5" aria-label="Identificador interno do depósito no ERP." />
                </span>
              </span>
            </th>
            <th className="px-3 font-semibold">Nome</th>
            <th className="px-3 font-semibold">Classificação</th>
            <th className="px-3 font-semibold">Entra na soma publicada?</th>
          </tr>
        </thead>
        <tbody>
          {warehouses.map((warehouse) => (
            <tr key={warehouse.bling_warehouse_id} className="border-b border-border-color">
              <td className="py-3 font-mono text-xs text-emerald-700">{warehouse.bling_warehouse_id}</td>
              <td className="px-3 py-3 font-medium">{warehouse.name}</td>
              <td className="px-3 py-3">
                <select
                  value={warehouse.role}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const role = event.target.value;
                    onChange({
                      ...warehouse,
                      role,
                      include_in_push: role === 'seller' ? warehouse.include_in_push : false,
                    });
                  }}
                  className="rounded-lg border border-border-color bg-bg-base px-2 py-1.5 text-xs disabled:opacity-60"
                >
                  {ROLES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
                </select>
              </td>
              <td className="px-3 py-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={warehouse.include_in_push}
                  disabled={!canEdit || warehouse.role === 'ml_full'}
                  title={warehouse.role === 'ml_full' ? 'O Full do Mercado Livre nunca entra na soma.' : 'Ligar soma este depósito no estoque publicado.'}
                  onClick={() => onChange({
                    ...warehouse,
                    role: warehouse.include_in_push ? warehouse.role : 'seller',
                    include_in_push: !warehouse.include_in_push,
                  })}
                  className={`relative h-6 w-11 rounded-full transition disabled:opacity-40 ${warehouse.include_in_push ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${warehouse.include_in_push ? 'left-5' : 'left-0.5'}`} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
