import { describe, expect, it } from 'vitest';
import {
  base64urlToBytes,
  bytesToBase64url,
  bytesToUtf8,
  CHALLENGE_NONCE_BYTES,
  encodeTranscript,
  exportPrivateKeyPkcs8,
  exportPublicKeySpki,
  generateChallengeNonce,
  generatePairingNonce,
  generatePairingSecret,
  generateSigningKeyPair,
  importPrivateKeyPkcs8,
  importPublicKeySpki,
  keyFingerprint,
  PAIRING_NONCE_BYTES,
  PAIRING_SECRET_BYTES,
  pairingProof,
  signPeerProof,
  toHex,
  utf8ToBytes,
  verifyPairingProof,
  verifyPeerProof,
} from './index.ts';

const utf8 = (s: string) => utf8ToBytes(s);

describe('base64url codec', () => {
  it('round-trips arbitrary bytes', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      expect(base64urlToBytes(bytesToBase64url(bytes))).toEqual(bytes);
    }
  });

  it('produces URL-safe unpadded output', () => {
    const out = bytesToBase64url(utf8('subjects?_re'));
    expect(out).not.toMatch(/[+/=]/);
  });

  it('utf8 round-trips', () => {
    expect(bytesToUtf8(utf8('héllo 👍'))).toBe('héllo 👍');
  });
});

describe('transcript encoding', () => {
  it('length-prefixes fields deterministically', () => {
    // "ab" (len 2) + "c" (len 1): 00000002 'a' 'b' 00000001 'c'
    const encoded = encodeTranscript(['ab', 'c']);
    expect(toHex(encoded)).toBe('0000000261620000000163');
  });

  it('rejects empty field lists', () => {
    expect(() => encodeTranscript([])).toThrow();
  });

  it('is unambiguous under concatenation shifts', () => {
    const a = encodeTranscript(['ab', 'cd']);
    const b = encodeTranscript(['abc', 'd']);
    const c = encodeTranscript(['a', 'bcd']);
    expect(toHex(a)).not.toBe(toHex(b));
    expect(toHex(a)).not.toBe(toHex(c));
  });
});

describe('pairing secret + HMAC proof (RFC 4231 cross-check)', () => {
  it('generates 256-bit secrets', () => {
    expect(base64urlToBytes(generatePairingSecret()).length).toBe(PAIRING_SECRET_BYTES);
  });

  it('generates ≥128-bit nonces', () => {
    expect(base64urlToBytes(generatePairingNonce()).length).toBeGreaterThanOrEqual(
      PAIRING_NONCE_BYTES / 2,
    );
    expect(base64urlToBytes(generateChallengeNonce()).length).toBeGreaterThanOrEqual(
      CHALLENGE_NONCE_BYTES / 2,
    );
  });

  it('matches the RFC 4231 HMAC-SHA-256 test vector via the same subtle.sign path', async () => {
    // RFC 4231 test case 1: key = 0x0b*20, data = "Hi There"
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(20).fill(0x0b),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8('Hi There')));
    expect(toHex(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  const transcript = {
    protocolVersion: '1',
    desktopDeviceId: 'dev_desktopdevice00000000000001',
    phoneDeviceId: 'dev_phonedevice0000000000000001',
    desktopFingerprint: 'AAAAfitnessAA',
    phoneFingerprint: 'BBBBfitnessBB',
    expiresAtMs: 1788800000000,
    nonce: 'noncevalue_noncevalue_',
  };

  it('accepts a correct proof and rejects a wrong secret', async () => {
    const secret = generatePairingSecret();
    const proof = await pairingProof(secret, transcript);
    expect(await verifyPairingProof(secret, transcript, bytesToBase64url(proof))).toBe(true);

    const wrongSecret = generatePairingSecret();
    expect(await verifyPairingProof(wrongSecret, transcript, bytesToBase64url(proof))).toBe(false);
  });

  it('rejects a modified transcript field', async () => {
    const secret = generatePairingSecret();
    const proof = await pairingProof(secret, transcript);
    const tampered = { ...transcript, phoneDeviceId: 'dev_evildevice0000000000000001' };
    expect(await verifyPairingProof(secret, tampered, bytesToBase64url(proof))).toBe(false);
  });

  it('rejects malformed proofs without throwing', async () => {
    const secret = generatePairingSecret();
    expect(await verifyPairingProof(secret, transcript, 'not-base64url!!')).toBe(false);
    expect(await verifyPairingProof('!!badsd', transcript, 'a'.repeat(43))).toBe(false);
  });
});

describe('device keys', () => {
  it('generates, exports, and re-imports P-256 keys', async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const spki = await exportPublicKeySpki(publicKey);
    const pkcs8 = await exportPrivateKeyPkcs8(privateKey);
    expect(spki.length).toBeGreaterThan(50);
    expect(pkcs8.length).toBeGreaterThan(100);

    const rePriv = await importPrivateKeyPkcs8(pkcs8);
    const rePub = await importPublicKeySpki(spki);
    expect(await keyFingerprint(rePub)).toBe(await keyFingerprint(publicKey));

    const transcript = {
      protocolVersion: '1',
      sessionId: 'sess_abcdefghijklmnopqrstuvwx',
      desktopDeviceId: 'dev_desktopdevice00000000000001',
      phoneDeviceId: 'dev_phonedevice0000000000000001',
      desktopFingerprint: 'AAAA',
      phoneFingerprint: 'BBBB',
      role: 'phone' as const,
      nonce: 'challenge_nonce_value_123',
    };
    const sig = await signPeerProof(rePriv, transcript);
    expect(await verifyPeerProof(rePub, transcript, sig)).toBe(true);
  });

  it('produces stable fingerprints for the same key and distinct across keys', async () => {
    const a = await generateSigningKeyPair();
    const b = await generateSigningKeyPair();
    expect(await keyFingerprint(a.publicKey)).toBe(await keyFingerprint(a.publicKey));
    expect(await keyFingerprint(a.publicKey)).not.toBe(await keyFingerprint(b.publicKey));
  });
});

describe('peer challenge proofs', () => {
  const base = {
    protocolVersion: '1',
    sessionId: 'sess_abcdefghijklmnopqrstuvwx',
    desktopDeviceId: 'dev_desktopdevice00000000000001',
    phoneDeviceId: 'dev_phonedevice0000000000000001',
    desktopFingerprint: 'fpDesktopAAA=',
    phoneFingerprint: 'fpPhoneAAAAA=',
  };

  async function setup() {
    const desktop = await generateSigningKeyPair();
    const phone = await generateSigningKeyPair();
    return {
      desktop,
      phone,
      desktopFp: await keyFingerprint(desktop.publicKey),
      phoneFp: await keyFingerprint(phone.publicKey),
    };
  }

  it('mutual proof round-trip with fresh nonces', async () => {
    const { desktop, phone, desktopFp, phoneFp } = await setup();
    const nonce = generateChallengeNonce();
    const phoneTranscript = {
      ...base,
      desktopFingerprint: desktopFp,
      phoneFingerprint: phoneFp,
      role: 'phone' as const,
      nonce,
    };
    const desktopTranscript = {
      ...base,
      desktopFingerprint: desktopFp,
      phoneFingerprint: phoneFp,
      role: 'desktop' as const,
      nonce,
    };
    const phoneSig = await signPeerProof(phone.privateKey, phoneTranscript);
    const desktopSig = await signPeerProof(desktop.privateKey, desktopTranscript);
    // The laptop verifies the phone's proof against the phone's stored public key;
    // the phone verifies the desktop's proof against the desktop's stored key.
    expect(await verifyPeerProof(phone.publicKey, phoneTranscript, phoneSig)).toBe(true);
    expect(await verifyPeerProof(desktop.publicKey, desktopTranscript, desktopSig)).toBe(true);
  });

  it('rejects a wrong peer key', async () => {
    const { desktop, phone, desktopFp, phoneFp } = await setup();
    const impostor = await generateSigningKeyPair();
    const transcript = {
      ...base,
      desktopFingerprint: desktopFp,
      phoneFingerprint: phoneFp,
      role: 'phone' as const,
      nonce: generateChallengeNonce(),
    };
    const sig = await signPeerProof(impostor.privateKey, transcript);
    expect(await verifyPeerProof(phone.publicKey, transcript, sig)).toBe(false);
    expect(await verifyPeerProof(desktop.publicKey, transcript, sig)).toBe(false);
  });

  it('rejects signature replay into another session', async () => {
    const { desktop, phone, desktopFp, phoneFp } = await setup();
    const nonce = generateChallengeNonce();
    const transcript = {
      ...base,
      desktopFingerprint: desktopFp,
      phoneFingerprint: phoneFp,
      role: 'phone' as const,
      nonce,
    };
    const sig = await signPeerProof(phone.privateKey, transcript);
    const otherSession = { ...transcript, sessionId: 'sess_zzzzzzzzzzzzzzzzzzzzzzzz' };
    expect(await verifyPeerProof(desktop.publicKey, otherSession, sig)).toBe(false);
  });

  it('rejects role reflection', async () => {
    const { desktop, phone, desktopFp, phoneFp } = await setup();
    const nonce = generateChallengeNonce();
    const phoneTranscript = {
      ...base,
      desktopFingerprint: desktopFp,
      phoneFingerprint: phoneFp,
      role: 'phone' as const,
      nonce,
    };
    const reflected = { ...phoneTranscript, role: 'desktop' as const };
    const sig = await signPeerProof(phone.privateKey, phoneTranscript);
    expect(await verifyPeerProof(desktop.publicKey, reflected, sig)).toBe(false);
  });

  it('rejects proofs from a previous session even with same devices', async () => {
    const { desktop, phone, desktopFp, phoneFp } = await setup();
    const old = {
      ...base,
      desktopFingerprint: desktopFp,
      phoneFingerprint: phoneFp,
      role: 'phone' as const,
      nonce: generateChallengeNonce(),
    };
    const sig = await signPeerProof(phone.privateKey, old);
    const fresh = { ...old, nonce: generateChallengeNonce() };
    expect(await verifyPeerProof(desktop.publicKey, fresh, sig)).toBe(false);
  });

  it('verify never throws on malformed signatures', async () => {
    const { desktop } = await setup();
    const transcript = {
      ...base,
      desktopFingerprint: 'x',
      phoneFingerprint: 'y',
      role: 'phone' as const,
      nonce: 'n',
    };
    expect(await verifyPeerProof(desktop.publicKey, transcript, '!!!!')).toBe(false);
  });
});
