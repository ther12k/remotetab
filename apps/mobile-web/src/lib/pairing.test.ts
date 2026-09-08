/**
 * Phone-side pairing identity binding (audit issue #23). The QR is the
 * source of truth for the desktop key; the pair.accepted payload relayed by
 * signaling must be proven consistent with it before anything is stored.
 */

import type { PairingPayloadV1 } from '@remotetab/crypto';
import {
  bytesToBase64url,
  exportPublicKeySpki,
  generateSigningKeyPair,
  keyFingerprint,
} from '@remotetab/crypto';
import { describe, expect, it } from 'vitest';
import { validateAcceptedDesktop } from './pairing.ts';

async function makePayload(): Promise<{ payload: PairingPayloadV1; spki: string; fp: string }> {
  const pair = await generateSigningKeyPair();
  const spki = bytesToBase64url(await exportPublicKeySpki(pair.publicKey));
  const fp = await keyFingerprint(pair.publicKey);
  const payload: PairingPayloadV1 = {
    v: 1,
    signalingOrigin: 'ws://signaling.test/ws',
    pairId: 'pair12345678',
    desktopDeviceId: 'dev_laptop000001',
    desktopSpki: spki,
    desktopFingerprint: fp,
    expiresAtMs: Date.now() + 300_000,
    nonce: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  };
  return { payload, spki, fp };
}

describe('validateAcceptedDesktop', () => {
  it('accepts the honest case and stores the QR key bytes', async () => {
    const { payload, spki, fp } = await makePayload();
    const check = await validateAcceptedDesktop(payload, {
      deviceId: payload.desktopDeviceId,
      displayName: 'Laptop',
      publicKeySpki: spki,
      publicKeyFingerprint: fp,
    });
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.desktop.publicKeySpki).toBe(spki); // QR bytes, not relay bytes
      expect(check.desktop.fingerprint).toBe(fp);
      expect(check.desktop.deviceId).toBe(payload.desktopDeviceId);
    }
  });

  it('rejects a relay that swaps the SPKI while keeping the claimed fingerprint (#23)', async () => {
    const { payload, fp } = await makePayload();
    const attacker = await generateSigningKeyPair();
    const check = await validateAcceptedDesktop(payload, {
      deviceId: payload.desktopDeviceId,
      publicKeySpki: bytesToBase64url(await exportPublicKeySpki(attacker.publicKey)),
      publicKeyFingerprint: fp, // legit fingerprint string preserved
    });
    expect(check.ok).toBe(false);
  });

  it('rejects when the fingerprint does not match the QR', async () => {
    const { payload, spki } = await makePayload();
    const check = await validateAcceptedDesktop(payload, {
      deviceId: payload.desktopDeviceId,
      publicKeySpki: spki,
      publicKeyFingerprint: 'BBBBBBBBBBBBBBBBBBBBBB',
    });
    expect(check.ok).toBe(false);
  });

  it('rejects a QR whose SPKI bytes do not belong to its own fingerprint', async () => {
    const { payload } = await makePayload();
    const other = await generateSigningKeyPair();
    const otherSpki = bytesToBase64url(await exportPublicKeySpki(other.publicKey));
    const otherFp = await keyFingerprint(other.publicKey);
    // Malformed QR: SPKI from one key, fingerprint from another.
    const badPayload: PairingPayloadV1 = {
      ...payload,
      desktopSpki: otherSpki,
      desktopFingerprint: otherFp,
    };
    const honest = await generateSigningKeyPair();
    const check = await validateAcceptedDesktop(badPayload, {
      deviceId: payload.desktopDeviceId,
      publicKeySpki: bytesToBase64url(await exportPublicKeySpki(honest.publicKey)),
      publicKeyFingerprint: await keyFingerprint(honest.publicKey),
    });
    expect(check.ok).toBe(false);
  });
});
