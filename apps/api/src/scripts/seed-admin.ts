/**
 * Cria o administrador local admin@jhshopping.local / admin.
 * Recusa produção e qualquer Postgres que não seja localhost.
 * O login da tela continua sendo e-mail e senha do HUB, sem OAuth do Bling ou da Nuvemshop.
 */
import { hashPassword } from '../auth/crypto.js';
import { createUser } from '../auth/service.js';
import { env } from '../config/env.js';
import { getPool, query } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { assertDevSeedAllowed } from './dev-seed-guard.js';

const DEV_EMAIL = 'admin@jhshopping.local';
const DEV_PASSWORD = 'admin';
const DEV_NAME = 'Admin local';

export async function seedLocalAdmin(): Promise<void> {
  assertDevSeedAllowed(env.NODE_ENV, env.DATABASE_URL);
  const existing = await query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [DEV_EMAIL]
  );
  const current = existing.rows[0];
  if (!current) {
    await createUser({
      email: DEV_EMAIL,
      name: DEV_NAME,
      password: DEV_PASSWORD,
      roles: ['admin'],
      mustChangePassword: false,
    });
    logger.info('Administrador local criado', { email: DEV_EMAIL });
    return;
  }

  const passwordHash = await hashPassword(DEV_PASSWORD);
  await query(
    `UPDATE users
     SET password_hash = $2, must_change_password = false, is_active = true, name = $3
     WHERE id = $1`,
    [current.id, passwordHash, DEV_NAME]
  );
  await query(
    `INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin')
     ON CONFLICT DO NOTHING`,
    [current.id]
  );
  logger.info('Administrador local atualizado', { email: DEV_EMAIL });
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('seed-admin.ts') || process.argv[1].endsWith('seed-admin.js'));

if (isDirectRun) {
  seedLocalAdmin()
    .then(async () => {
      await getPool().end();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error('seed:admin falhou', {
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await getPool().end();
      } catch {
        /* o pool pode nem ter conectado */
      }
      process.exit(1);
    });
}
