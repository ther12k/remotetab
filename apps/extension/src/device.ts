/**
 * Full device identity: stable id + ECDSA P-256 signing key (issue #013).
 * The private key lives ONLY in this device's storage; just the SPKI public
 * key and its fingerprint ever travel.
 */

import {
  base64urlToBytes,
  bytesToBase64url,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generateSigningKeyPair,
  importPrivateKeyPkcs8,
  importPublicKeySpki,
  keyFingerprint,
} from '@remotetab/crypto';
import { newDeviceId } from '@remotetab/protocol';

export const DEVICE_KEY = 'device';

export type DeviceIdentity = {
  deviceId: string;
  displayName: string;
  privateKeyPkcs8: string;
  publicKeySpki: string;
  fingerprint: string;
};

interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isValidIdentity(value: unknown): value is DeviceIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.deviceId === 'string' &&
    v.deviceId.length >= 8 &&
    typeof v.displayName === 'string' &&
    typeof v.privateKeyPkcs8 === 'string' &&
    typeof v.publicKeySpki === 'string' &&
    typeof v.fingerprint === 'string'
  );
}

export class DeviceIdentityStore {
  constructor(private readonly area: StorageAreaLike) {}

  async loadOrCreate(): Promise<DeviceIdentity> {
    const result = await this.area.get(DEVICE_KEY);
    const raw = result[DEVICE_KEY];
    if (isValidIdentity(raw)) return raw;
    const pair = await generateSigningKeyPair();
    const identity: DeviceIdentity = {
      deviceId: newDeviceId(),
      displayName: 'This laptop',
      privateKeyPkcs8: bytesToBase64url(await exportPrivateKeyPkcs8(pair.privateKey)),
      publicKeySpki: bytesToBase64url(await exportPublicKeySpki(pair.publicKey)),
      fingerprint: await keyFingerprint(pair.publicKey),
    };
    await this.area.set({ [DEVICE_KEY]: identity });
    return identity;
  }

  /** Import the stored private key for signing (desktop peer proof, #014). */
  async importPrivateKey(identity: DeviceIdentity) {
    return importPrivateKeyPkcs8(base64urlToBytes(identity.privateKeyPkcs8));
  }

  async importPublicKey(identity: DeviceIdentity) {
    return importPublicKeySpki(base64urlToBytes(identity.publicKeySpki));
  }
}
