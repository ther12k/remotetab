import { describe, expect, it } from 'vitest';
import {
  decodeSignalingFrame,
  MAX_SIGNALING_FRAME_BYTES,
  nonceSchema,
  parseSignalingMessage,
  SIGNALING_MESSAGE_TYPES,
  signalingErrorFrame,
  signalingFrame,
} from './index.ts';

describe('signaling frames', () => {
  it('round-trips hello with correlation id', () => {
    const frame = signalingFrame(
      'hello',
      { role: 'desktop', deviceId: 'devabcdefghijklmnopqrstuvwx', displayName: 'Laptop' },
      { id: 'reqabcdefghijklmnopqrst' },
    );
    const r = decodeSignalingFrame(JSON.stringify(frame));
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.value.id).toBe('reqabcdefghijklmnopqrst');
  });

  it('rejects unknown types and unknown versions', () => {
    expect(parseSignalingMessage({ v: 1, type: 'boot.node', payload: {} }).ok).toBe(false);
    expect(
      parseSignalingMessage({
        v: 2,
        type: 'hello',
        payload: { role: 'desktop', deviceId: 'devabcdefghijklmnopqrstuvwx' },
      }).ok,
    ).toBe(false);
  });

  it('rejects hello with bad role/deviceId', () => {
    expect(
      parseSignalingMessage({
        v: 1,
        type: 'hello',
        payload: { role: 'admin', deviceId: 'devabcdefghijklmnopqrstuvwx' },
      }).ok,
    ).toBe(false);
    expect(
      parseSignalingMessage({ v: 1, type: 'hello', payload: { role: 'phone', deviceId: 'x' } }).ok,
    ).toBe(false);
  });

  it('rejects oversized frames before JSON parsing', () => {
    const huge = JSON.stringify({
      v: 1,
      type: 'hello',
      payload: { pad: 'a'.repeat(MAX_SIGNALING_FRAME_BYTES) },
    });
    const r = decodeSignalingFrame(huge);
    expect(r.ok === false && r.error.code).toBe('MESSAGE_TOO_LARGE');
  });

  it('rejects invalid JSON', () => {
    const r = decodeSignalingFrame(']]]');
    expect(r.ok === false && r.error.code).toBe('MESSAGE_INVALID');
  });

  it('builds typed error frames', () => {
    const frame = signalingErrorFrame(
      'reqabcdefghijklmnopqrst',
      'PAIR_EXPIRED',
      'Pairing expired, scan a new code',
    );
    expect(frame.type).toBe('error');
    const r = parseSignalingMessage(frame);
    expect(r.ok).toBe(true);
  });

  it('rejects error frames with unknown codes', () => {
    const r = parseSignalingMessage({
      v: 1,
      replyTo: 'reqabcdefghijklmnopqrst',
      type: 'error',
      payload: { code: 'SOMETHING_ELSE' },
    });
    expect(r.ok).toBe(false);
  });

  it('validates pair.join key material shapes', () => {
    const join = {
      pairId: 'pairabcdefghijklmnopqrstuvwx',
      deviceId: 'devabcdefghijklmnopqrstuvwx',
      publicKeySpki: 'BCDEFabcdefghijklmnopqrstuvwxyz12345678901234567890',
      publicKeyFingerprint: 'fp_ab',
      pairingProof: 'a'.repeat(43),
    };
    expect(parseSignalingMessage({ v: 1, type: 'pair.join', payload: join }).ok).toBe(true);
    expect(
      parseSignalingMessage({
        v: 1,
        type: 'pair.join',
        payload: { ...join, publicKeySpki: 'not base64url!!' },
      }).ok,
    ).toBe(false);
  });

  it('validates signal.ice nullable fields', () => {
    const ice = {
      sessionId: 'sessabcdefghijklmnopqrstuv',
      candidate: 'candidate:842163049 1 udp 1677729535 192.168.1.4 61796 typ srflx',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'uf',
    };
    expect(parseSignalingMessage({ v: 1, type: 'signal.ice', payload: ice }).ok).toBe(true);
    expect(
      parseSignalingMessage({ v: 1, type: 'signal.ice', payload: { ...ice, sdpMid: null } }).ok,
    ).toBe(true);
  });

  it('covers all documented signaling families', () => {
    for (const t of [
      'hello',
      'hello.ok',
      'pair.create',
      'pair.created',
      'pair.join',
      'pair.accept',
      'pair.accepted',
      'pair.reject',
      'pair.rejected',
      'session.request',
      'session.accepted',
      'session.rejected',
      'session.close',
      'signal.offer',
      'signal.answer',
      'signal.ice',
      'presence.ping',
      'presence.pong',
      'error',
    ]) {
      expect(SIGNALING_MESSAGE_TYPES).toContain(t);
    }
  });
});

describe('nonce schema', () => {
  it('accepts 16+ bytes of base64url entropy', () => {
    expect(nonceSchema.safeParse('a'.repeat(22)).success).toBe(true);
    expect(nonceSchema.safeParse('a'.repeat(43)).success).toBe(true);
  });

  it('rejects low-entropy or malformed nonces', () => {
    expect(nonceSchema.safeParse('abc').success).toBe(false);
    expect(nonceSchema.safeParse(`${'a'.repeat(21)}+`).success).toBe(false);
    expect(nonceSchema.safeParse('a'.repeat(200)).success).toBe(false);
  });
});
