/**
 * Phone-side pairing (issue #013): parse the QR payload, prove knowledge of
 * the one-time secret with HMAC, and store the desktop's public identity
 * ONLY after the fingerprint in pair.accepted matches the QR (TOFU via QR).
 */

import {
  bytesToBase64url,
  decodePairingPayload,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generateSigningKeyPair,
  importPrivateKeyPkcs8,
  keyFingerprint,
  type PairingPayloadV1,
  pairingProof,
} from '@remotetab/crypto';
import { newDeviceId } from '@remotetab/protocol';
import { loadPhoneIdentity } from './phone-identity.ts';

export type { PairingPayloadV1 };
export { decodePairingPayload };

const KEYSTORE_KEY = 'remotetab.phone.keys';
const DESKTOPS_KEY = 'remotetab.phone.desktops';

export type PhoneKeyIdentity = {
  deviceId: string;
  displayName: string;
  privateKeyPkcs8: string;
  publicKeySpki: string;
  fingerprint: string;
};

export type PairedDesktop = {
  deviceId: string;
  displayName?: string;
  publicKeySpki: string;
  fingerprint: string;
  pairedAtMs: number;
};

export async function loadPhoneKeys(): Promise<PhoneKeyIdentity> {
  return loadOrCreatePhoneKeys();
}

async function loadOrCreatePhoneKeys(): Promise<PhoneKeyIdentity> {
  const base = loadPhoneIdentity();
  try {
    const raw = localStorage.getItem(KEYSTORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PhoneKeyIdentity>;
      if (typeof parsed.privateKeyPkcs8 === 'string' && typeof parsed.publicKeySpki === 'string') {
        return {
          deviceId: base.deviceId,
          displayName: base.displayName,
          privateKeyPkcs8: parsed.privateKeyPkcs8,
          publicKeySpki: parsed.publicKeySpki,
          fingerprint: parsed.fingerprint ?? '',
        };
      }
    }
  } catch {
    // fall through and mint keys
  }
  const pair = await generateSigningKeyPair();
  const identity: PhoneKeyIdentity = {
    deviceId: base.deviceId,
    displayName: base.displayName,
    privateKeyPkcs8: bytesToBase64url(await exportPrivateKeyPkcs8(pair.privateKey)),
    publicKeySpki: bytesToBase64url(await exportPublicKeySpki(pair.publicKey)),
    fingerprint: await keyFingerprint(pair.publicKey),
  };
  localStorage.setItem(KEYSTORE_KEY, JSON.stringify(identity));
  return identity;
}

export async function listPairedDesktops(): Promise<PairedDesktop[]> {
  try {
    const raw = localStorage.getItem(DESKTOPS_KEY);
    return raw ? (JSON.parse(raw) as PairedDesktop[]) : [];
  } catch {
    return [];
  }
}

export async function getPairedDesktop(deviceId: string): Promise<PairedDesktop | undefined> {
  return (await listPairedDesktops()).find((d) => d.deviceId === deviceId);
}

export async function forgetDesktop(deviceId: string): Promise<void> {
  const list = await listPairedDesktops();
  localStorage.setItem(DESKTOPS_KEY, JSON.stringify(list.filter((d) => d.deviceId !== deviceId)));
}

async function storeDesktop(desktop: PairedDesktop): Promise<void> {
  const list = (await listPairedDesktops()).filter((d) => d.deviceId !== desktop.deviceId);
  list.push(desktop);
  localStorage.setItem(DESKTOPS_KEY, JSON.stringify(list));
}

/** Everything the phone sends in pair.join. */
export async function buildPairJoin(payload: PairingPayloadV1): Promise<{
  deviceId: string;
  displayName: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
  pairingProof: string;
}> {
  const phone = await loadOrCreatePhoneKeys();
  const proof = await pairingProof(payload.secret, {
    protocolVersion: '1',
    desktopDeviceId: payload.desktopDeviceId,
    phoneDeviceId: phone.deviceId,
    desktopFingerprint: payload.desktopFingerprint,
    phoneFingerprint: phone.fingerprint,
    expiresAtMs: payload.expiresAtMs,
    nonce: payload.nonce,
  });
  return {
    deviceId: phone.deviceId,
    displayName: phone.displayName,
    publicKeySpki: phone.publicKeySpki,
    publicKeyFingerprint: phone.fingerprint,
    pairingProof: bytesToBase64url(proof),
  };
}

/** The QR fingerprint MUST equal what the laptop sends in pair.accepted. */
export function desktopFingerprintMatches(
  payload: PairingPayloadV1,
  acceptedFingerprint: string,
): boolean {
  return acceptedFingerprint === payload.desktopFingerprint;
}

/**
 * Dedicated pairing session over signaling: hello(phone) → pair.join →
 * pair.accepted | pair.rejected. Closed as soon as pairing settles.
 */
export class PairingSession {
  private socket: WebSocket | null = null;

  constructor(
    private readonly opts: {
      url: string;
      payload: PairingPayloadV1;
      onSettled: (
        result: { ok: true; desktop: PairedDesktop } | { ok: false; reason: string },
      ) => void;
    },
  ) {}

  start(): void {
    const socket = new WebSocket(this.opts.payload.signalingOrigin || this.opts.url);
    this.socket = socket;
    socket.onopen = async () => {
      const phone = await loadOrCreatePhoneKeys();
      socket.send(
        JSON.stringify({
          v: 1,
          id: newDeviceId().replace('dev_', 'req_'),
          type: 'hello',
          payload: { role: 'phone', deviceId: phone.deviceId, displayName: phone.displayName },
        }),
      );
    };
    socket.onmessage = async (ev) => {
      const frame = JSON.parse(String(ev.data)) as {
        type: string;
        payload: Record<string, unknown>;
      };
      if (frame.type === 'hello.ok') {
        const join = await buildPairJoin(this.opts.payload);
        socket.send(
          JSON.stringify({
            v: 1,
            id: newDeviceId().replace('dev_', 'req_'),
            type: 'pair.join',
            payload: { pairId: this.opts.payload.pairId, ...join },
          }),
        );
        return;
      }
      if (frame.type === 'pair.accepted') {
        const desktop = frame.payload.desktop as {
          deviceId: string;
          displayName?: string;
          publicKeySpki: string;
          publicKeyFingerprint: string;
        };
        if (!desktopFingerprintMatches(this.opts.payload, desktop.publicKeyFingerprint)) {
          this.settle({
            ok: false,
            reason: 'The laptop identity changed since the QR was shown. Pair again.',
          });
          return;
        }
        const stored: PairedDesktop = {
          deviceId: desktop.deviceId,
          displayName: desktop.displayName,
          publicKeySpki: desktop.publicKeySpki,
          fingerprint: desktop.publicKeyFingerprint,
          pairedAtMs: Date.now(),
        };
        await storeDesktop(stored);
        this.settle({ ok: true, desktop: stored });
        return;
      }
      if (frame.type === 'pair.rejected' || frame.type === 'error') {
        const code = (frame.payload as { code?: string }).code ?? 'error';
        const reason =
          code === 'PAIR_EXPIRED'
            ? 'The pairing window expired. Generate a new code on the laptop.'
            : code === 'PAIR_ALREADY_USED'
              ? 'That code was already used. Generate a new one.'
              : `Pairing failed (${code}).`;
        this.settle({ ok: false, reason });
      }
    };
    socket.onerror = () => {
      this.settle({ ok: false, reason: 'Could not reach the signaling server.' });
    };
  }

  private settled = false;
  private settle(
    result: { ok: true; desktop: PairedDesktop } | { ok: false; reason: string },
  ): void {
    if (this.settled) return;
    this.settled = true;
    this.stop();
    this.opts.onSettled(result);
  }

  stop(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState <= WebSocket.OPEN) socket.close(1000, 'pairing-done');
    }
  }
}

export { importPrivateKeyPkcs8 };
