/**
 * Script de Bootstrap Operacional do Bling Sync HUB
 *
 * Executa:
 * 1. As 12 migrations + 70 partições mensais + seeds iniciais no PostgreSQL 16 (DATABASE_URL).
 * 2. Criação idempotente dos 4 usuários iniciais por papel:
 *    - admin@blingsync.local (admin)
 *    - fiscal1@blingsync.local (fiscal_approver - 1ª revisão NCM/EAN)
 *    - fiscal2@blingsync.local (fiscal_approver - 2ª revisão NCM/TIPI)
 *    - operador@blingsync.local (operator - matching/conteúdo/push)
 */

import { getPool, query } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { createUser } from '../auth/service.js';
import { UserRole } from '../auth/types.js';
import { logger } from '../lib/logger.js';

const INITIAL_USERS: Array<{
  email: string;
  name: string;
  passwordEnvKey: string;
  defaultPassword: string;
  roles: UserRole[];
}> = [
  {
    email: 'admin@blingsync.local',
    name: 'Administrador Bling Sync HUB',
    passwordEnvKey: 'BOOTSTRAP_ADMIN_PASSWORD',
    defaultPassword: 'ChangeMe!Admin2026',
    roles: ['admin'],
  },
  {
    email: 'fiscal1@blingsync.local',
    name: 'Aprovador Fiscal 01 (GVE / NVE)',
    passwordEnvKey: 'BOOTSTRAP_FISCAL1_PASSWORD',
    defaultPassword: 'ChangeMe!Fiscal01_2026',
    roles: ['fiscal_approver'],
  },
  {
    email: 'fiscal2@blingsync.local',
    name: 'Aprovador Fiscal 02 (Dupla Confirmação TIPI)',
    passwordEnvKey: 'BOOTSTRAP_FISCAL2_PASSWORD',
    defaultPassword: 'ChangeMe!Fiscal02_2026',
    roles: ['fiscal_approver'],
  },
  {
    email: 'operador@blingsync.local',
    name: 'Operador de Catálogo (PIRE / VIR / CQS)',
    passwordEnvKey: 'BOOTSTRAP_OPERATOR_PASSWORD',
    defaultPassword: 'ChangeMe!Operator2026',
    roles: ['operator'],
  },
];

export async function runBootstrap(): Promise<void> {
  logger.info('Iniciando bootstrap do Bling Sync HUB...');
  const appliedMigrations = await runAllMigrationsUp();
  logger.info('Migrations verificadas/aplicadas', {
    appliedCount: appliedMigrations.length,
    appliedMigrations,
  });

  for (const u of INITIAL_USERS) {
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [u.email]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      logger.info('Usuário inicial já existe, mantendo registro', { email: u.email });
      continue;
    }

    const password = process.env[u.passwordEnvKey] || u.defaultPassword;
    const created = await createUser({
      email: u.email,
      name: u.name,
      password,
      roles: u.roles,
    });
    logger.info('Usuário inicial criado com sucesso', {
      id: created.id,
      email: created.email,
      roles: created.roles,
    });
  }

  logger.info('Bootstrap concluído com sucesso.');
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('bootstrap.ts') || process.argv[1].endsWith('bootstrap.js'));

if (isDirectRun) {
  runBootstrap()
    .then(async () => {
      await getPool().end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('Erro fatal durante o bootstrap', {
        error: err instanceof Error ? err.message : String(err),
      });
      await getPool().end();
      process.exit(1);
    });
}
