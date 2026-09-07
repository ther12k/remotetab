/**
 * Desktop pairing flow (issue #013). The laptop mints a 256-bit one-time
 * secret + nonce, renders them as a QR (payload carries the secret — the
 * signaling server never sees it), and verifies the phone's HMAC proof over
 * a transcript binding BOTH device fingerprints. Success consumes the secret.
 */

import {
  decodePairingPayload,
  encodePairingPayload,
  generatePairingNonce,
  generatePairingSecret,
  type PairingPayloadV1 as Payload,
  verifyPairingProof,
} from '@remotetab/crypto';
import { pairJoinSchema, type SignalingMessage, signalingFrame } from '@remotetab/protocol';
import type { DeviceIdentity } from './device.ts';
import type { PairedDeviceStore } from './paired-devices.ts';

export type PendingPairing = {
  payload: Payload;
  createdAtMs: number;
};

export type PairingOutcome =
  | { ok: true; device: { deviceId: string; displayName?: string; fingerprint: string } }
  | { ok: false; reason: string };

export type SignalingSend = (frame: SignalingMessage) => boolean;

export class PairingManager {
  private pending: PendingPairing | null = null;

  constructor(
    private readonly deps: {
      identity: DeviceIdentity;
      devices: PairedDeviceStore;
      send: SignalingSend;
      nowMs?: () => number;
    },
  ) {}

  /** Create a pairing and return the QR payload for the popup. */
  async create(ttlSeconds = 300): Promise<{ payload: string; expiresAtMs: number }> {
    const secret = generatePairingSecret();
    const nonce = generatePairingNonce();
    const now = this.deps.nowMs?.() ?? Date.now();
    // pairId arrives from the server; a local placeholder id fills the payload
    // until pair.created correlates back. We rebuild the payload then.
    const placeholder = crypto.randomUUID().replaceAll('-', '');
    this.pending = {
      payload: {
        v: 1,
        signalingOrigin: '', // filled once the server confirms (needs pairId)
        pairId: placeholder,
        desktopDeviceId: this.deps.identity.deviceId,
        desktopSpki: this.deps.identity.publicKeySpki,
        desktopFingerprint: this.deps.identity.fingerprint,
        expiresAtMs: now + ttlSeconds * 1000,
        nonce,
        secret,
      },
      createdAtMs: now,
    };
    this.deps.send(
      signalingFrame(
        'pair.create',
        {
          ttlSeconds,
          publicKeySpki: this.deps.identity.publicKeySpki,
          publicKeyFingerprint: this.deps.identity.fingerprint,
          displayName: this.deps.identity.displayName,
        },
        { id: placeholder },
      ),
    );
    return { payload: '', expiresAtMs: now + ttlSeconds * 1000 };
  }

  /** Server confirmed the pairing window: finalize the QR payload. */
  onPairCreated(
    pairId: string,
    expiresAtMs: number,
  ): { payload: string; expiresAtMs: number } | null {
    const pending = this.pending;
    if (!pending) return null;
    pending.payload.pairId = pairId;
    pending.payload.expiresAtMs = expiresAtMs;
    return { payload: encodePairingPayload(pending.payload), expiresAtMs };
  }

  /** Cancel: destroy the secret; the server window simply expires. */
  cancel(): void {
    this.pending = null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** Handle a pair.join relayed by the signaling service. */
  async onPairJoin(
    frame: Extract<SignalingMessage, { type: 'pair.join' }>,
  ): Promise<PairingOutcome> {
    const pending = this.pending;
    if (!pending) return { ok: false, reason: 'no pending pairing' };
    const join = pairJoinSchema.parse(frame.payload);
    const now = this.deps.nowMs?.() ?? Date.now();
    if (now >= pending.payload.expiresAtMs || join.pairId !== pending.payload.pairId) {
      this.pending = null;
      this.deps.send(signalingFrame('pair.reject', { pairId: join.pairId, code: 'PAIR_EXPIRED' }));
      return { ok: false, reason: 'expired' };
    }
    const proof = await verifyPairingProof(
      pending.payload.secret,
      {
        protocolVersion: '1',
        desktopDeviceId: this.deps.identity.deviceId,
        phoneDeviceId: join.deviceId,
        desktopFingerprint: this.deps.identity.fingerprint,
        phoneFingerprint: join.publicKeyFingerprint,
        expiresAtMs: pending.payload.expiresAtMs,
        nonce: pending.payload.nonce,
      },
      join.pairingProof,
    );
    if (!proof) {
      this.deps.send(
        signalingFrame('pair.reject', { pairId: join.pairId, code: 'PAIR_INVALID_PROOF' }),
      );
      return { ok: false, reason: 'invalid proof' };
    }
    // Consume: a used secret never verifies again.
    this.pending = null;
    this.deps.send(signalingFrame('pair.accept', { pairId: join.pairId }));
    await this.deps.devices.upsert({
      deviceId: join.deviceId,
      displayName: join.displayName ?? 'Paired phone',
      publicKeySpki: join.publicKeySpki,
      publicKeyFingerprint: join.publicKeyFingerprint,
      addedAtMs: now,
    });
    return {
      ok: true,
      device: {
        deviceId: join.deviceId,
        displayName: join.displayName,
        fingerprint: join.publicKeyFingerprint,
      },
    };
  }
}

export { decodePairingPayload, encodePairingPayload };
