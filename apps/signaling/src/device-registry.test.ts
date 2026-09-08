import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryDeviceRegistry, SqliteDeviceRegistry } from './device-registry.ts';

const SPKI_A = 'AAAA-spki-device-a-AAAAAAAAAAAAAAAAAAAA';
const FP_A = 'AAAA-fingerprint-a-AAAAAAAAAAAAAA';
const SPKI_B = 'BBBB-spki-device-b-BBBBBBBBBBBBBBBB';
const FP_B = 'BBBB-fingerprint-b-BBBBBBBBBBBBBB';

for (const make of [
  () => new MemoryDeviceRegistry(),
  () => {
    const dir = mkdtempSync(join(tmpdir(), 'remotetab-registry-'));
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
    return new SqliteDeviceRegistry(join(dir, 'devices.sqlite'));
  },
]) {
  const kind = make().constructor.name;

  describe(`DeviceRegistry enroll semantics (${kind})`, () => {
    test('enrolls a new device', () => {
      const reg = make();
      expect(reg.enroll('dev_newdevice00000001', SPKI_A, FP_A, 'Phone')).toBe('enrolled');
      expect(reg.get('dev_newdevice00000001')?.publicKeySpki).toBe(SPKI_A);
      expect(reg.get('dev_newdevice00000001')?.fingerprint).toBe(FP_A);
    });

    test('re-presenting the same identity is idempotent (#24)', () => {
      const reg = make();
      reg.enroll('dev_idem0000000000001', SPKI_A, FP_A);
      expect(reg.enroll('dev_idem0000000000001', SPKI_A, FP_A)).toBe('known');
      expect(reg.get('dev_idem0000000000001')?.publicKeySpki).toBe(SPKI_A);
    });

    test('a different key for an existing deviceId is a conflict and never overwrites (#24)', () => {
      const reg = make();
      reg.enroll('dev_conflict000000001', SPKI_A, FP_A);
      expect(reg.enroll('dev_conflict000000001', SPKI_B, FP_B)).toBe('conflict');
      expect(reg.get('dev_conflict000000001')?.publicKeySpki).toBe(SPKI_A);
      expect(reg.get('dev_conflict000000001')?.fingerprint).toBe(FP_A);
    });

    test('revocation still works on enrolled devices', () => {
      const reg = make();
      reg.enroll('dev_revoked0000000001', SPKI_A, FP_A);
      expect(reg.isRevoked('dev_revoked0000000001')).toBe(false);
      expect(reg.revoke('dev_revoked0000000001', 1234)).toBe(true);
      expect(reg.isRevoked('dev_revoked0000000001')).toBe(true);
      expect(reg.revoke('dev_revoked0000000001', 5678)).toBe(false);
    });
  });
}
