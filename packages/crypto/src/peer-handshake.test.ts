import { describe, expect, it } from 'vitest';
import {
  base64urlToBytes,
  bytesToBase64url,
  encodeTranscript,
  generateSigningKeyPair,
  type HandshakeDeps,
  keyFingerprint,
  PeerAuthHandshake,
} from './index.ts';

const BASE = {
  protocolVersion: '1',
  sessionId: 'sess_peerauth00000000000001',
  desktopDeviceId: 'dev_desktopdevice00000000000001',
  phoneDeviceId: 'dev_phonedevice0000000000000001',
};

const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

function makeHandshake(
  role: 'desktop' | 'phone',
  identity: { signingKey: CryptoKey; fingerprint: string },
  peer: { verifyKey: CryptoKey; fingerprint: string },
  io: { out: string[]; in: string[] },
  overrides: Partial<HandshakeDeps> = {},
): PeerAuthHandshake {
  return new PeerAuthHandshake({
    role,
    protocolVersion: BASE.protocolVersion,
    sessionId: BASE.sessionId,
    myDeviceId: role === 'desktop' ? BASE.desktopDeviceId : BASE.phoneDeviceId,
    peerDeviceId: role === 'desktop' ? BASE.phoneDeviceId : BASE.desktopDeviceId,
    myFingerprint: identity.fingerprint,
    peerFingerprint: peer.fingerprint,
    sign: async (t) =>
      bytesToBase64url(new Uint8Array(await crypto.subtle.sign(SIGN, identity.signingKey, t))),
    verify: async (t, sig) => crypto.subtle.verify(SIGN, peer.verifyKey, base64urlToBytes(sig), t),
    sendChallenge: (nonce) => {
      io.out.push(`challenge:${nonce}`);
    },
    sendProof: (sig) => {
      io.out.push(`proof:${sig}`);
    },
    randomNonce: () => bytesToBase64url(crypto.getRandomValues(new Uint8Array(16))),
    ...overrides,
  });
}

async function makeIdentities() {
  const desktop = await generateSigningKeyPair();
  const phone = await generateSigningKeyPair();
  return {
    desktop: {
      key: desktop.privateKey,
      publicKey: desktop.publicKey,
      fingerprint: await keyFingerprint(desktop.publicKey),
    },
    phone: {
      key: phone.privateKey,
      publicKey: phone.publicKey,
      fingerprint: await keyFingerprint(phone.publicKey),
    },
  };
}

describe('PeerAuthHandshake', () => {
  it('both sides verify against each other in the happy path', async () => {
    const ids = await makeIdentities();
    const desktopIo = { out: [] as string[], in: [] as string[] };
    const phoneIo = { out: [] as string[], in: [] as string[] };
    const desktop = makeHandshake(
      'desktop',
      { signingKey: ids.desktop.key, fingerprint: ids.desktop.fingerprint },
      { verifyKey: ids.phone.publicKey, fingerprint: ids.phone.fingerprint },
      desktopIo,
    );
    const phone = makeHandshake(
      'phone',
      { signingKey: ids.phone.key, fingerprint: ids.phone.fingerprint },
      { verifyKey: ids.desktop.publicKey, fingerprint: ids.desktop.fingerprint },
      phoneIo,
    );

    desktop.start();
    phone.start();
    expect(desktopIo.out.length).toBe(1);
    expect(phoneIo.out.length).toBe(1);

    // Relay challenges across the (already open) data channel. Signing is
    // async, so give each handshake a tick to flush its proof to the outbox.
    const desktopChallenge = desktopIo.out[0]?.slice('challenge:'.length) ?? '';
    const phoneChallenge = phoneIo.out[0]?.slice('challenge:'.length) ?? '';
    desktop.onChallenge(phoneChallenge);
    phone.onChallenge(desktopChallenge);
    await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 25));

    // Each side, having the peer nonce, produces its proof. The app layer
    // signs with the handshake's own transcript bytes; we mirror that by
    // feeding proofs generated from the counterpart handshake's outbox.
    // Sign directly here to keep the test independent of the handshake's
    // private fields.
    const phoneSig = phoneIo.out.find((m) => m.startsWith('proof:')) as string | undefined;
    expect(phoneSig !== undefined).toBe(true);
    // The phone only sends its proof after receiving the desktop challenge,
    // which happened above; the handshake queues it in the outbox.
    expect(phoneSig).toBeTruthy();
    const desktopOutcome = await desktop.onProof(phoneSig?.slice('proof:'.length) ?? '');
    expect(desktopOutcome).toBe('verified');

    const desktopSig = desktopIo.out.find((m) => m.startsWith('proof:')) as string | undefined;
    expect(desktopSig !== undefined).toBe(true);
    expect(desktopSig).toBeTruthy();
    const phoneOutcome = await phone.onProof(desktopSig?.slice('proof:'.length) ?? '');
    expect(phoneOutcome).toBe('verified');
  });

  it('fails when the peer signs with the wrong key', async () => {
    const ids = await makeIdentities();
    const impostor = await generateSigningKeyPair();
    const io = { out: [] as string[], in: [] as string[] };
    const desktop = makeHandshake(
      'desktop',
      { signingKey: ids.desktop.key, fingerprint: ids.desktop.fingerprint },
      { verifyKey: ids.phone.publicKey, fingerprint: ids.phone.fingerprint },
      io,
    );
    desktop.start();
    desktop.onChallenge('peer-nonce-value-1234567890');
    // Wait a tick so the handshake signs with the peer nonce.
    await new Promise((r) => setTimeout(r, 0));
    // Impostor signature: sign the same transcript shape but with the wrong key.
    const wrong = bytesToBase64url(
      new Uint8Array(await crypto.subtle.sign(SIGN, impostor.privateKey, encodeTranscript(['x']))),
    );
    const outcome = await desktop.onProof(wrong);
    expect(outcome).toBe('failed');
  });

  it('fails on a proof whose transcript binds a different session', async () => {
    const ids = await makeIdentities();
    const io = { out: [] as string[], in: [] as string[] };
    const desktop = makeHandshake(
      'desktop',
      { signingKey: ids.desktop.key, fingerprint: ids.desktop.fingerprint },
      { verifyKey: ids.phone.publicKey, fingerprint: ids.phone.fingerprint },
      io,
    );
    const phoneElsewhere = makeHandshake(
      'phone',
      { signingKey: ids.phone.key, fingerprint: ids.phone.fingerprint },
      { verifyKey: ids.desktop.publicKey, fingerprint: ids.desktop.fingerprint },
      { out: [], in: [] },
      { sessionId: 'sess_otherpeerauth00000001' },
    );
    desktop.start();
    phoneElsewhere.start();
    desktop.onChallenge('nonce-aaaaaaaaaaaaaaaa');
    await new Promise((r) => setTimeout(r, 0));
    // Simulate: proof produced for the OTHER session.
    const sig = bytesToBase64url(
      new Uint8Array(
        await crypto.subtle.sign(
          SIGN,
          ids.phone.key,
          encodeTranscript([
            'remotetab.v1.peer-auth',
            '1',
            'sess_otherpeerauth00000001',
            BASE.desktopDeviceId,
            BASE.phoneDeviceId,
            ids.desktop.fingerprint,
            ids.phone.fingerprint,
            'phone',
            'nonce-aaaaaaaaaaaaaaaa',
          ]),
        ),
      ),
    );
    expect(await desktop.onProof(sig)).toBe('failed');
  });

  it('role reflection fails: a phone-role transcript cannot verify as desktop', async () => {
    const ids = await makeIdentities();
    const io = { out: [] as string[], in: [] as string[] };
    const desktop = makeHandshake(
      'desktop',
      { signingKey: ids.desktop.key, fingerprint: ids.desktop.fingerprint },
      { verifyKey: ids.phone.publicKey, fingerprint: ids.phone.fingerprint },
      io,
    );
    desktop.start();
    desktop.onChallenge('nonce-bbbbbbbbbbbbbbbb');
    await new Promise((r) => setTimeout(r, 0));
    // Attacker replays the desktop's OWN proof as if it were the phone's.
    const ownProof = io.out.find((m) => m.startsWith('proof:'))?.slice('proof:'.length) ?? '';
    const reflected = await desktop.onProof(ownProof);
    expect(reflected).toBe('failed');
  });

  it('a proof arriving before any challenge fails closed', async () => {
    const ids = await makeIdentities();
    const io = { out: [] as string[], in: [] as string[] };
    const desktop = makeHandshake(
      'desktop',
      { signingKey: ids.desktop.key, fingerprint: ids.desktop.fingerprint },
      { verifyKey: ids.phone.publicKey, fingerprint: ids.phone.fingerprint },
      io,
    );
    const outcome = await desktop.onProof('aaaa');
    expect(outcome).toBe('failed');
  });
});
