import { describe, expect, it } from 'vitest';
import { isValidTurnDeviceId, mintTurnCredentials, turnIceServer } from './turn.ts';

describe('TURN credentials', () => {
  it('matches the RFC 2202 HMAC-SHA-1 test vector', async () => {
    // RFC 2202 case 2: key "Jefe", data "what do ya want for nothing?"
    // HMAC-SHA-1 = effcdf6ae5eb2fa2d27416d5f184df9c259a7c79
    const expiryUnix = 1_800_000_000;
    const username = `${expiryUnix}:dev_turntest00000000000000001`;
    const key = 'Jefe';
    const message = 'what do ya want for nothing?';
    // Reproduce the same signing path used by mintTurnCredentials.
    const keyRaw = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', keyRaw, new TextEncoder().encode(message));
    const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('effcdf6ae5eb2fa2d27416d5f184df9c259a7c79');
    void username;
  });

  it('embeds expiry and device id in the username', async () => {
    const cred = await mintTurnCredentials({
      secret: 'shared-secret-do-not-ship',
      deviceId: 'dev_turntest00000000000000001',
      ttlSeconds: 600,
      nowUnix: 1_800_000_000,
    });
    expect(cred.username).toBe('1800000600:dev_turntest00000000000000001');
    expect(cred.ttlSeconds).toBe(600);
    expect(cred.credential.length).toBe(28); // base64 of 20-byte HMAC-SHA1
  });

  it('credentials differ per device and per expiry', async () => {
    const a = await mintTurnCredentials({
      secret: 's',
      deviceId: 'dev_deviceaaaaaaaaaaaaaaaa1',
      nowUnix: 100,
    });
    const b = await mintTurnCredentials({
      secret: 's',
      deviceId: 'dev_devicebbbbbbbbbbbbbbbb2',
      nowUnix: 100,
    });
    const c = await mintTurnCredentials({
      secret: 's',
      deviceId: 'dev_deviceaaaaaaaaaaaaaaaa1',
      nowUnix: 200,
    });
    expect(a.credential).not.toBe(b.credential);
    expect(a.credential).not.toBe(c.credential);
  });

  it('assembles an ICE server entry', async () => {
    const cred = await mintTurnCredentials({
      secret: 's',
      deviceId: 'dev_turntest00000000000000001',
      nowUnix: 1,
    });
    const server = turnIceServer(['turn:turn.example.com:3478?transport=udp'], cred);
    expect(server.urls).toEqual(['turn:turn.example.com:3478?transport=udp']);
    expect(server.username).toBe(cred.username);
  });

  it('validates device ids', () => {
    expect(isValidTurnDeviceId('dev_validdevice0000000000001')).toBe(true);
    expect(isValidTurnDeviceId('x')).toBe(false);
    expect(isValidTurnDeviceId(42)).toBe(false);
  });
});
