import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

if (!process.env.VITEST) {
  dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
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
    .regex(/^[0-9a-fA-F]{64}$/, 'OAUTH_ENCRYPTION_KEY deve conter 64 caracteres hex (32 bytes)')
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = envSchema.parse(process.env);
