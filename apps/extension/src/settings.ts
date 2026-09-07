/**
 * Extension settings persisted in chrome.storage.local (never synced):
 * signaling endpoint and ICE server URLs. No secrets belong here; TURN
 * credentials arrive per-session from the signaling service (#017).
 */

export type ExtensionSettings = {
  signalingUrl: string;
  /** Plain stun:/turn: URL strings; credentials come from the server later. */
  iceUrls: string[];
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  signalingUrl: 'ws://localhost:8787/ws',
  iceUrls: ['stun:stun.l.google.com:19302'],
};

export const SETTINGS_KEY = 'settings';

interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export function isValidSettings(value: unknown): value is ExtensionSettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.signalingUrl !== 'string' || !/^wss?:\/\/.+/.test(v.signalingUrl)) return false;
  if (!Array.isArray(v.iceUrls) || v.iceUrls.length > 16) return false;
  return v.iceUrls.every(
    (u) =>
      typeof u === 'string' &&
      (u.startsWith('stun:') || u.startsWith('turn:') || u.startsWith('turns:')),
  );
}

export class SettingsStore {
  constructor(private readonly area: StorageAreaLike) {}

  async load(): Promise<ExtensionSettings> {
    const result = await this.area.get(SETTINGS_KEY);
    const raw = result[SETTINGS_KEY];
    return isValidSettings(raw) ? raw : { ...DEFAULT_SETTINGS };
  }

  async save(settings: ExtensionSettings): Promise<void> {
    if (!isValidSettings(settings)) throw new Error('invalid settings');
    await this.area.set({ [SETTINGS_KEY]: settings });
  }
}
