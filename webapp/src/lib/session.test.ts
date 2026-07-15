import { describe, expect, it, beforeAll } from 'vitest';
import { createSessionCookieValue, readSessionCookieValue } from './session';

describe('session sealing', () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = 'a'.repeat(32);
  });

  it('round-trips session data through seal/unseal', async () => {
    const sealed = await createSessionCookieValue({ userId: 'user-123' });
    const unsealed = await readSessionCookieValue(sealed);
    expect(unsealed?.userId).toBe('user-123');
  });

  it('returns null for a garbage cookie value', async () => {
    const result = await readSessionCookieValue('not-a-real-sealed-value');
    expect(result).toBeNull();
  });
});
