import crypto from 'node:crypto';

/**
 * Primitivas AES-256-GCM com a chave passada por parâmetro.
 * Ficam separadas de `crypto.ts` para a rotação de chave rodar sem depender de `config/env`.
 *
 * Formato binário interno: [12 bytes IV][16 bytes AuthTag][ciphertext].
 * O banco guarda os bytes hex: em `oauth_tokens` como `bytea`, em `channel_app_credentials` como texto.
 */
export const OAUTH_KEY_HEX = /^[0-9a-fA-F]{64}$/;

export function assertOAuthKey(keyHex: string, label: string): string {
  const key = (keyHex ?? '').trim();
  if (!OAUTH_KEY_HEX.test(key)) {
    throw new Error(`${label} inválida: são necessários 64 caracteres hex (32 bytes).`);
  }
  return key;
}

export function encryptWithKey(keyHex: string, plainText: string): Buffer {
  const key = Buffer.from(assertOAuthKey(keyHex, 'Chave'), 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const rawEnvelope = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  return Buffer.from(rawEnvelope.toString('hex'), 'utf8');
}

export function decryptWithKey(keyHex: string, payload: Buffer | string): string {
  const asText = typeof payload === 'string' ? payload : payload.toString('utf8');
  const rawEnvelope =
    /^[0-9a-fA-F]+$/.test(asText) && asText.length >= 56 ? Buffer.from(asText, 'hex') : Buffer.from(asText, 'utf8');

  if (rawEnvelope.length < 28) {
    throw new Error('Payload de token OAuth criptografado inválido');
  }

  const key = Buffer.from(assertOAuthKey(keyHex, 'Chave'), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, rawEnvelope.subarray(0, 12));
  decipher.setAuthTag(rawEnvelope.subarray(12, 28));
  const decrypted = Buffer.concat([decipher.update(rawEnvelope.subarray(28)), decipher.final()]);
  return decrypted.toString('utf8');
}
