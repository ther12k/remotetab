/**
 * Phone-side pairing (issue #013): parse the QR payload, prove knowledge of
 * the one-time secret with HMAC, and store the desktop's public identity
 * ONLY after the fingerprint in pair.accepted matches the QR (TOFU via QR).
 */

import {
  base64urlToBytes,
  bytesToBase64url,
  decodePairingPayload,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  fingerprintFromSpkiB64,
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
const IDB_NAME = 'remotetab-identity';
const IDB_STORE = 'keys';
const IDB_ENTRY = 'device';

/**
 * The phone signing identity (audit issue #30): the private key lives as a
 * NON-extractable CryptoKey in IndexedDB. It can sign challenges for as long
 * as the origin is trusted, but its bytes can never be exported again — web
 * storage compromise no longer yields the long-term secret. If IndexedDB is
 * unavailable the identity is session-scoped (in memory) rather than
 * persisted in an exportable form.
 */
export type PhoneKeyIdentity = {
  deviceId: string;
  displayName: string;
  privateKey: CryptoKey;
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

type StoredKeyRecord = {
  deviceId: string;
  displayName: string;
  publicKeySpki: string;
  fingerprint: string;
  privateKey: CryptoKey;
};

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const open = indexedDB.open(IDB_NAME, 1);
    open.onupgradeneeded = () => {
      if (open.result.objectStoreNames.contains(IDB_STORE)) return;
      open.result.createObjectStore(IDB_STORE);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error('indexedDB open failed'));
  });
}

function idbGet(db: IDBDatabase): Promise<StoredKeyRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_ENTRY);
    req.onsuccess = () => resolve(req.result as StoredKeyRecord | undefined);
    req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'));
  });
}

function idbPut(db: IDBDatabase, record: StoredKeyRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record, IDB_ENTRY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
  });
}

let memoryIdentity: PhoneKeyIdentity | null = null;

export async function loadPhoneKeys(): Promise<PhoneKeyIdentity> {
  if (memoryIdentity) return memoryIdentity;
  const base = loadPhoneIdentity();
  try {
    const db = await openIdentityDb();
    const stored = await idbGet(db);
    if (stored) {
      memoryIdentity = {
        deviceId: stored.deviceId,
        displayName: stored.displayName,
        privateKey: stored.privateKey,
        publicKeySpki: stored.publicKeySpki,
        fingerprint: stored.fingerprint,
      };
      return memoryIdentity;
    }
    // Legacy alpha keystores held exportable PKCS#8 in localStorage; upgrade
    // them to a non-extractable key and remove the exportable copy.
    const legacy = localStorage.getItem(KEYSTORE_KEY);
    let upgraded: PhoneKeyIdentity | null = null;
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as {
          privateKeyPkcs8?: string;
          publicKeySpki?: string;
          fingerprint?: string;
        };
        if (
          typeof parsed.privateKeyPkcs8 === 'string' &&
          typeof parsed.publicKeySpki === 'string'
        ) {
          const privateKey = await importPrivateKeyPkcs8(
            base64urlToBytes(parsed.privateKeyPkcs8),
            false,
          );
          upgraded = {
            deviceId: base.deviceId,
            displayName: base.displayName,
            privateKey,
            publicKeySpki: parsed.publicKeySpki,
            fingerprint: parsed.fingerprint ?? '',
          };
        }
      } catch {
        // Corrupt legacy entry: fall through and mint fresh keys.
      }
    }
    const identity = upgraded ?? (await mintPhoneIdentity(base));
    await idbPut(db, { ...identity });
    if (legacy) localStorage.removeItem(KEYSTORE_KEY);
    memoryIdentity = identity;
    return memoryIdentity;
  } catch {
    // No IndexedDB: keep the identity in memory only (session-scoped).
    memoryIdentity ??= await mintPhoneIdentity(base);
    return memoryIdentity;
  }
}

/** Generate a fresh identity; only the pkcs8 bytes ever exist, transiently. */
async function mintPhoneIdentity(base: {
  deviceId: string;
  displayName: string;
}): Promise<PhoneKeyIdentity> {
  const pair = await generateSigningKeyPair();
  const pkcs8 = await exportPrivateKeyPkcs8(pair.privateKey);
  const privateKey = await importPrivateKeyPkcs8(pkcs8, false);
  return {
    deviceId: base.deviceId,
    displayName: base.displayName,
    privateKey,
    publicKeySpki: bytesToBase64url(await exportPublicKeySpki(pair.publicKey)),
    fingerprint: await keyFingerprint(pair.publicKey),
  };
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
  const phone = await loadPhoneKeys();
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

/** The desktop identity fields relayed by signaling in pair.accepted. */
export type AcceptedDesktop = {
  deviceId: string;
  displayName?: string;
  publicKeySpki: string;
  publicKeyFingerprint: string;
};

/**
 * Validate the desktop identity for pairing (audit issue #23). A hostile
 * signaling relay must not be able to substitute the desktop key:
 *  1. the claimed fingerprint must equal the QR fingerprint (TOFU anchor);
 *  2. the fingerprint must be the LOCAL hash of the received SPKI bytes;
 *  3. the received SPKI must byte-match the QR's desktopSpki — the QR is the
 *     source of truth and the stored identity is built from it.
 */
export async function validateAcceptedDesktop(
  payload: PairingPayloadV1,
  accepted: AcceptedDesktop,
): Promise<{ ok: true; desktop: PairedDesktop } | { ok: false; reason: string }> {
  if (!desktopFingerprintMatches(payload, accepted.publicKeyFingerprint)) {
    return {
      ok: false,
      reason: 'The laptop identity changed since the QR was shown. Pair again.',
    };
  }
  const computed = await fingerprintFromSpkiB64(accepted.publicKeySpki);
  if (computed !== accepted.publicKeyFingerprint) {
    return {
      ok: false,
      reason: 'The laptop key does not match its claimed fingerprint. Pairing aborted.',
    };
  }
  if (accepted.publicKeySpki !== payload.desktopSpki) {
    return {
      ok: false,
      reason: 'The laptop key does not match the QR code. Pairing aborted.',
    };
  }
  return {
    ok: true,
    desktop: {
      deviceId: accepted.deviceId,
      displayName: accepted.displayName,
      publicKeySpki: payload.desktopSpki,
      fingerprint: payload.desktopFingerprint,
      pairedAtMs: Date.now(),
    },
  };
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
      const phone = await loadPhoneKeys();
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
        const desktop = frame.payload.desktop as AcceptedDesktop;
        const check = await validateAcceptedDesktop(this.opts.payload, desktop);
        if (!check.ok) {
          this.settle({ ok: false, reason: check.reason });
          return;
        }
        await storeDesktop(check.desktop);
        this.settle({ ok: true, desktop: check.desktop });
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
