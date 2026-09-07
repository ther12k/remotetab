import { utf8ToBytes } from './b64.ts';

/**
 * Canonical transcript encoding: every field is length-prefixed with a 4-byte
 * big-endian integer over its UTF-8 bytes, eliminating concatenation
 * ambiguity. The first field is always the domain separator, so proofs and
 * signatures computed for one purpose can never verify for another.
 */
export function encodeTranscript(fields: string[]): Uint8Array<ArrayBuffer> {
  if (fields.length === 0) {
    throw new Error('transcript must contain at least a domain separator');
  }
  const encoded = fields.map((f) => utf8ToBytes(f));
  const total = encoded.reduce((acc, b) => acc + 4 + b.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const b of encoded) {
    view.setUint32(offset, b.length, false);
    offset += 4;
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
