import { randomBytes } from 'node:crypto';

export function generateOAuthState(): string {
  return randomBytes(16).toString('hex');
}
