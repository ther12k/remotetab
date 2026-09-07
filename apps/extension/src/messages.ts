/**
 * Typed message contracts between the popup, the service worker, and (later)
 * the offscreen media host. Every inbound message is validated with these
 * guards before handling — unknown or malformed messages are ignored rather
 * than guessed at.
 */

import type { SessionState } from './session-state.ts';

/** Popup -> service worker requests. */
export type PopupRequest =
  | { type: 'getState' }
  | { type: 'enableRemote'; tabId: number }
  | { type: 'stopRemote' };

export type StateResponse = {
  ok: boolean;
  state?: SessionState;
  error?: { code: string; message: string };
};

export function isPopupRequest(value: unknown): value is PopupRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'getState':
      return true;
    case 'enableRemote':
      return typeof v.tabId === 'number' && Number.isSafeInteger(v.tabId) && v.tabId > 0;
    case 'stopRemote':
      return true;
    default:
      return false;
  }
}

/** Service worker -> popup state broadcast (via storage.onChanged). */
export const SESSION_STATE_KEY = 'sessionState';
