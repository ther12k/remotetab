/**
 * Pairing identity binding (audit issue #23). A hostile signaling relay must
 * not be able to substitute the phone's SPKI while keeping the fingerprint
 * string and HMAC proof intact — the laptop recomputes the fingerprint from
 * the received key bytes before trusting (or storing) anything.
 */

import {
  bytesToBase64url,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generatePairingNonce,
  generatePairingSecret,
  generateSigningKeyPair,
  keyFingerprint,
  pairingProof,
} from '@remotetab/crypto';
import type { SignalingMessage } from '@remotetab/protocol';
import { describe, expect, it } from 'vitest';
import type { PairedDevice, PairedDeviceStore } from './paired-devices.ts';
import { PairingManager } from './pairing-manager.ts';

const NOW_MS = 1_000_000;
const EXPIRES_MS = NOW_MS + 300_000;
const LAPTOP_ID = 'dev_laptop000001';
const PHONE_ID = 'dev_phone0000001';
const PAIR_ID = 'pair12345678';

function fakeStore(): { store: PairedDeviceStore; upserts: PairedDevice[] } {
  const upserts: PairedDevice[] = [];
  const store = {
    async listActive(): Promise<PairedDevice[]> {
      return upserts;
    },
    async findActive(deviceId: string): Promise<PairedDevice | undefined> {
      return upserts.find((d) => d.deviceId === deviceId);
    },
    async upsert(device: PairedDevice): Promise<void> {
      upserts.push(device);
    },
    async markRevoked(_deviceId: string): Promise<boolean> {
      return false;
    },
  } as unknown as PairedDeviceStore;
  return { store, upserts };
}

async function laptopIdentity() {
  const pair = await generateSigningKeyPair();
  return {
    deviceId: LAPTOP_ID,
    displayName: 'Laptop',
    privateKeyPkcs8: bytesToBase64url(await exportPrivateKeyPkcs8(pair.privateKey)),
    publicKeySpki: bytesToBase64url(await exportPublicKeySpki(pair.publicKey)),
    fingerprint: await keyFingerprint(pair.publicKey),
  };
}

async function phoneJoin(opts: {
  secret: string;
  nonce: string;
  desktopFingerprint: string;
  spki: string;
  fingerprint: string;
}): Promise<{
  pairId: string;
  deviceId: string;
  displayName?: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  pairingProof: string;
}> {
  const proof = await pairingProof(opts.secret, {
    protocolVersion: '1',
    desktopDeviceId: LAPTOP_ID,
    phoneDeviceId: PHONE_ID,
    desktopFingerprint: opts.desktopFingerprint,
    phoneFingerprint: opts.fingerprint,
    expiresAtMs: EXPIRES_MS,
    nonce: opts.nonce,
  });
  return {
    pairId: PAIR_ID,
    deviceId: PHONE_ID,
    displayName: 'Phone',
    publicKeySpki: opts.spki,
    publicKeyFingerprint: opts.fingerprint,
    pairingProof: bytesToBase64url(proof),
  };
}

async function makeManager() {
  const identity = await laptopIdentity();
  const { store, upserts } = fakeStore();
  const sent: SignalingMessage[] = [];
  const manager = new PairingManager({
    identity,
    devices: store,
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    nowMs: () => NOW_MS,
  });
  const secret = generatePairingSecret();
  const nonce = generatePairingNonce();
  await manager.create(300, { secret, nonce });
  manager.onPairCreated(PAIR_ID, EXPIRES_MS);
  return { manager, sent, upserts, secret, nonce, identity };
}

describe('PairingManager identity binding', () => {
  it('accepts a phone whose SPKI hashes to its claimed fingerprint', async () => {
    const { manager, upserts, secret, nonce, identity } = await makeManager();
    const phone = await generateSigningKeyPair();
    const spki = bytesToBase64url(await exportPublicKeySpki(phone.publicKey));
    const fingerprint = await keyFingerprint(phone.publicKey);
    const join = await phoneJoin({
      secret,
      nonce,
      desktopFingerprint: identity.fingerprint,
      spki,
      fingerprint,
    });

    const outcome = await manager.onPairJoin({
      v: 1,
      id: 'req_test00000001',
      type: 'pair.join',
      payload: join,
    });
    expect(outcome.ok).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.publicKeySpki).toBe(spki);
    expect(upserts[0]?.publicKeyFingerprint).toBe(fingerprint);
  });

  it('rejects a relay that swaps the SPKI but keeps fingerprint + proof (#23)', async () => {
    const { manager, sent, upserts, secret, nonce, identity } = await makeManager();
    const phone = await generateSigningKeyPair();
    const phoneFingerprint = await keyFingerprint(phone.publicKey);
    const attacker = await generateSigningKeyPair();
    const attackerSpki = bytesToBase64url(await exportPublicKeySpki(attacker.publicKey));

    const join = await phoneJoin({
      secret,
      nonce,
      desktopFingerprint: identity.fingerprint,
      spki: attackerSpki, // swapped by the relay
      fingerprint: phoneFingerprint, // claimed string untouched
    });
    const outcome = await manager.onPairJoin({
      v: 1,
      id: 'req_test00000002',
      type: 'pair.join',
      payload: join,
    });

    expect(outcome.ok).toBe(false);
    const reject = sent.find((f) => f.type === 'pair.reject');
    expect(reject?.type).toBe('pair.reject');
    if (reject?.type === 'pair.reject') {
      expect(reject.payload.code).toBe('PAIR_INVALID_PROOF');
    }
    expect(upserts).toHaveLength(0); // attacker key never stored
  });

  it('rejects a self-inconsistent join (fingerprint not the hash of its own SPKI)', async () => {
    const { manager, upserts, secret, nonce, identity } = await makeManager();
    const phone = await generateSigningKeyPair();
    const spki = bytesToBase64url(await exportPublicKeySpki(phone.publicKey));
    const join = await phoneJoin({
      secret,
      nonce,
      desktopFingerprint: identity.fingerprint,
      spki,
      fingerprint: 'AAAAAAAAAAAAAAAAAAAAAA', // claimed fingerprint matches nothing
    });
    const outcome = await manager.onPairJoin({
      v: 1,
      id: 'req_test00000003',
      type: 'pair.join',
      payload: join,
    });
    expect(outcome.ok).toBe(false);
    expect(upserts).toHaveLength(0);
  });
});
