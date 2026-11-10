import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

if (!process.env.VITEST) {
  const envFiles = ['.env', '.env.local', '../../.env', '../../.env.local'];
  for (const file of envFiles) {
    dotenv.config({ path: path.resolve(process.cwd(), file) });
  }
}

/**
 * Produção e desenvolvimento exigem a variável. O fallback público foi removido
 * para não criptografar token com uma chave conhecida. Só o Vitest recebe uma chave de teste.
 */
export function resolveOAuthEncryptionKey(value: string | undefined, vitest: boolean): string {
  const provided = value?.trim() ?? '';
  if (/^[0-9a-fA-F]{64}$/.test(provided)) return provided;
  if (vitest) return 'f'.repeat(64);
  throw new Error(
    'OAUTH_ENCRYPTION_KEY ausente ou inválida. Defina 64 caracteres hex (32 bytes) antes de iniciar a API.'
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://bling_hub:bling_hub_dev@localhost:5432/bling_sync_hub'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_COOKIE_NAME: z.string().min(1).default('bling_hub_sid'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  SESSION_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  OAUTH_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'OAUTH_ENCRYPTION_KEY deve conter 64 caracteres hex (32 bytes)'),
  ENABLE_LIVE_PUBLISHING: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = envSchema.parse({
  ...process.env,
  OAUTH_ENCRYPTION_KEY: resolveOAuthEncryptionKey(process.env.OAUTH_ENCRYPTION_KEY, process.env.VITEST === 'true'),
});
