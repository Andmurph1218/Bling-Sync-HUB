import crypto from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';
import { env } from '../config/env.js';

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
 * Formato binário interno: [12 bytes IV][16 bytes AuthTag][ciphertext], codificado em bytes hex no Buffer bytea.
 */
export function encryptOAuthToken(plainText: string): Buffer {
  const key = Buffer.from(env.OAUTH_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const rawEnvelope = Buffer.concat([iv, authTag, encrypted]);
  return Buffer.from(rawEnvelope.toString('hex'), 'utf8');
}

export function decryptOAuthToken(payload: Buffer): string {
  const asText = payload.toString('utf8');
  const rawEnvelope =
    /^[0-9a-fA-F]+$/.test(asText) && asText.length >= 56
      ? Buffer.from(asText, 'hex')
      : payload;

  if (rawEnvelope.length < 28) {
    throw new Error('Payload de token OAuth criptografado inválido');
  }
  const key = Buffer.from(env.OAUTH_ENCRYPTION_KEY, 'hex');
  const iv = rawEnvelope.subarray(0, 12);
  const authTag = rawEnvelope.subarray(12, 28);
  const encrypted = rawEnvelope.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
