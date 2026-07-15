import { describe, expect, it } from 'vitest';
import { generateOAuthState } from './oauth-state';

describe('generateOAuthState', () => {
  it('returns a 32-character hex string', () => {
    const state = generateOAuthState();
    expect(state).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns a different value each call', () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });
});
