import { describe, expect, it } from 'vitest';
import { resolveOAuthEncryptionKey } from '../config/env.js';

describe('OAUTH_ENCRYPTION_KEY', () => {
  it('recusa iniciar sem uma chave de 64 hex', () => {
    expect(() => resolveOAuthEncryptionKey(undefined, false)).toThrow(/OAUTH_ENCRYPTION_KEY/);
    expect(() => resolveOAuthEncryptionKey('curta', false)).toThrow(/OAUTH_ENCRYPTION_KEY/);
  });

  it('aceita a chave definida no ambiente', () => {
    const key = 'ab'.repeat(32);
    expect(resolveOAuthEncryptionKey(key, false)).toBe(key);
  });
});
