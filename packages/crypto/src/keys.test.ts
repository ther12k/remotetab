import { describe, expect, it } from 'vitest';
import {
  bytesToBase64url,
  exportPublicKeySpki,
  fingerprintFromSpkiB64,
  generateSigningKeyPair,
  keyFingerprint,
} from './index.ts';

describe('SPKI fingerprint helpers', () => {
  it('fingerprintFromSpkiB64 matches keyFingerprint of the imported key', async () => {
    const pair = await generateSigningKeyPair();
    const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
    const fromKey = await keyFingerprint(pair.publicKey);
    const fromBytes = await fingerprintFromSpkiB64(spki);
    expect(fromBytes).toBe(fromKey);
  });

  it('different keys produce different fingerprints', async () => {
    const a = await generateSigningKeyPair();
    const b = await generateSigningKeyPair();
    const fa = await keyFingerprint(a.publicKey);
    const fb = await keyFingerprint(b.publicKey);
    expect(fa).not.toBe(fb);
  });
});
