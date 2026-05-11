/**
 * UUID v4 generation — stdlib only, no dependencies.
 */
import { randomUUID } from 'crypto';

export function generateUUID(): string {
  return randomUUID();
}
