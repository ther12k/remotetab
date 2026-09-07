import { bytesToBase64url } from './b64.ts';

/**
 * ECDSA P-256 device identity keys (ADR-008). Private keys are extractable so
 * they can be persisted by the owning device only; they are never exported to
 * any peer or service. No primitives are implemented here beyond WebCrypto.
 */

export const KEY_ALG = 'ECDSA' as const;
const P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export type SigningKeyPair = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

export async function generateSigningKeyPair(): Promise<SigningKeyPair> {
  const pair = await crypto.subtle.generateKey(P256, true, ['sign', 'verify']);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

export async function exportPublicKeySpki(publicKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
}

export async function exportPrivateKeyPkcs8(
  privateKey: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
}

export async function importPublicKeySpki(spki: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', spki as Uint8Array<ArrayBuffer>, P256, true, ['verify']);
}

export async function importPrivateKeyPkcs8(pkcs8: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pkcs8 as Uint8Array<ArrayBuffer>, P256, true, ['sign']);
}

/** SHA-256 digest of the SPKI encoding, truncated to 16 bytes (128-bit). */
export async function keyFingerprint(publicKey: CryptoKey): Promise<string> {
  const spki = await exportPublicKeySpki(publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
  return bytesToBase64url(digest.slice(0, 16));
}
