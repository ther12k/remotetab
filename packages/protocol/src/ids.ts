import { ID_PATTERN } from './limits.ts';

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

function randomBase32(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = '';
  for (const b of buf) {
    out += BASE32_ALPHABET[b % 32];
  }
  return out;
}

/** Prefixed random identifier, e.g. `sess_ab3k9...`. 8–64 chars, [A-Za-z0-9_-]. */
export function newId(prefix: 'dev' | 'sess' | 'pair' | 'req' | 'epoch'): string {
  return `${prefix}_${randomBase32(20)}`;
}

export const newDeviceId = () => newId('dev');
export const newSessionId = () => newId('sess');
export const newPairId = () => newId('pair');
export const newRequestId = () => newId('req');

/** True when `id` matches the wire id shape. */
export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}
