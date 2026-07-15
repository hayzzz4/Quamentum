import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from './crypto';

describe('crypto', () => {
  const key = randomBytes(32);

  it('round-trips a plaintext string', () => {
    const ciphertext = encrypt('strava-access-token-123', key);
    expect(decrypt(ciphertext, key)).toBe('strava-access-token-123');
  });

  it('produces different ciphertext for the same plaintext each call', () => {
    const a = encrypt('same-input', key);
    const b = encrypt('same-input', key);
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong key', () => {
    const ciphertext = encrypt('secret', key);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });
});
