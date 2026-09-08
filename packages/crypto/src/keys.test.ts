import { describe, expect, it } from 'vitest';
import {
  bytesToBase64url,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  fingerprintFromSpkiB64,
  generateSigningKeyPair,
  importPrivateKeyPkcs8,
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

describe('non-extractable private keys (#30)', () => {
  it('a non-extractable import can sign but never export', async () => {
    const pair = await generateSigningKeyPair();
    const pkcs8 = await exportPrivateKeyPkcs8(pair.privateKey);
    const hardened = await importPrivateKeyPkcs8(pkcs8, false);
    expect(hardened.extractable).toBe(false);
    // Signing works...
    const sig = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      hardened,
      new TextEncoder().encode('payload'),
    );
    expect(sig.byteLength).toBeGreaterThan(0);
    // ...but the bytes can never leave again.
    await expect(crypto.subtle.exportKey('pkcs8', hardened)).rejects.toThrow();
  });
});
