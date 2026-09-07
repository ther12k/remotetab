import { newDeviceId } from '@remotetab/protocol';

/**
 * Phone device identity in localStorage (per-origin). Only the stable id and
 * a display name live here; the P-256 signing key lands with pairing (#013)
 * and never leaves the device.
 */

const KEY = 'remotetab.phone.identity';

export type PhoneIdentity = {
  deviceId: string;
  displayName: string;
};

export function loadPhoneIdentity(): PhoneIdentity {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PhoneIdentity>;
      if (typeof parsed.deviceId === 'string' && parsed.deviceId.length >= 8) {
        const identity: PhoneIdentity = {
          deviceId: parsed.deviceId,
          displayName: typeof parsed.displayName === 'string' ? parsed.displayName : defaultName(),
        };
        return identity;
      }
    }
  } catch {
    // Corrupt storage: fall through and mint a fresh identity.
  }
  const identity: PhoneIdentity = { deviceId: newDeviceId(), displayName: defaultName() };
  savePhoneIdentity(identity);
  return identity;
}

export function savePhoneIdentity(identity: PhoneIdentity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // Storage unavailable (private mode): identity becomes session-scoped.
  }
}

function defaultName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  return 'This phone';
}
