import crypto from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { env } from '../config/env.js';
import { decryptWithKey, encryptWithKey } from './oauth-key.js';

const ARGON2_MEMORY_COST = 19456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  return argon2id({
    password: plainPassword,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_COST,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'encoded',
  });
}

export async function verifyPassword(passwordHash: string, plainPassword: string): Promise<boolean> {
  try {
    return await argon2Verify({
      password: plainPassword,
      hash: passwordHash,
    });
  } catch {
    return false;
  }
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashSessionToken(opaqueToken: string): string {
  return crypto.createHash('sha256').update(opaqueToken, 'utf8').digest('hex');
}

/**
 * Criptografa tokens OAuth (AES-256-GCM) para armazenamento em oauth_tokens (bytea).
 * O formato do envelope e as primitivas ficam em `oauth-key.ts`.
 */
export function encryptOAuthToken(plainText: string): Buffer {
  return encryptWithKey(env.OAUTH_ENCRYPTION_KEY, plainText);
}

export function decryptOAuthToken(payload: Buffer): string {
  return decryptWithKey(env.OAUTH_ENCRYPTION_KEY, payload);
}
