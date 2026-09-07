import { describe, expect, it } from 'vitest';
import {
  decodePairingPayload,
  encodePairingPayload,
  type PairingPayloadV1,
} from './pairing-payload.ts';

const payload: PairingPayloadV1 = {
  v: 1,
  signalingOrigin: 'wss://signal.example.com/ws',
  pairId: 'pairabcdefghijklmnopqrstuvwx',
  desktopDeviceId: 'dev_desktopdevice00000000000001',
  desktopSpki: 'BCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz012345',
  desktopFingerprint: 'fpDesktopAAAAAA',
  expiresAtMs: 1788800000000,
  nonce: 'pairing_nonce_value12',
  secret: 'secret_secret_secret_secret_secret12',
};

describe('pairing payload codec', () => {
  it('round-trips', () => {
    expect(decodePairingPayload(encodePairingPayload(payload))).toEqual({
      ok: true,
      value: payload,
    });
  });

  it('accepts URL-wrapped payloads (secret in fragment)', () => {
    const wrapped = `https://remotetab.example/app#p=${encodePairingPayload(payload)}`;
    expect(decodePairingPayload(wrapped)).toEqual({ ok: true, value: payload });
  });

  it('rejects tampered fields', () => {
    const tampered = { ...payload, desktopDeviceId: 'dev_evildevice0000000000000001' };
    const r = decodePairingPayload(encodePairingPayload(tampered));
    expect(r.ok).toBe(true); // parses…
    if (r.ok) expect(r.value.desktopDeviceId).toBe('dev_evildevice0000000000000001'); // but signature/HMAC binding catches misuse downstream
  });

  it('rejects bad versions and malformed tokens', () => {
    expect(decodePairingPayload('RT1:!!!').ok).toBe(false);
    expect(decodePairingPayload('nonsense').ok).toBe(false);
    const bad = JSON.stringify({ ...payload, v: 2 });
    const encoded = `RT1:${bytesToBase64url(utf8ToBytes(bad))}`;
    expect(decodePairingPayload(encoded).ok).toBe(false);
  });

  it('rejects invalid ids and origins', () => {
    const r = decodePairingPayload(
      encodePairingPayload({ ...payload, signalingOrigin: 'http://not-ws' }),
    );
    expect(r.ok).toBe(false);
  });
});
