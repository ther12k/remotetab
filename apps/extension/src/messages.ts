/**
 * Typed message contracts between the popup, the service worker, and the
 * offscreen media host. Every inbound message is validated with these guards
 * before handling — unknown or malformed messages are ignored rather than
 * guessed at.
 */

import type { SessionState } from './session-state.ts';

/** Popup -> service worker requests. */
export type PopupRequest =
  | { type: 'getState' }
  | { type: 'enableRemote'; tabId: number; streamId: string }
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
      return (
        typeof v.tabId === 'number' &&
        Number.isSafeInteger(v.tabId) &&
        v.tabId > 0 &&
        typeof v.streamId === 'string' &&
        v.streamId.length > 0 &&
        v.streamId.length <= 512
      );
    case 'stopRemote':
      return true;
    default:
      return false;
  }
}

/** Service worker -> offscreen media host requests. */
export type OffscreenRequest =
  | { type: 'offscreen:startCapture'; streamId: string }
  | { type: 'offscreen:stopCapture' };

export type OffscreenResponse =
  | { ok: true; track: { width: number; height: number } | null }
  | { ok: false; code: string; message: string };

export function isOffscreenRequest(value: unknown): value is OffscreenRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'offscreen:startCapture':
      return typeof v.streamId === 'string' && v.streamId.length > 0 && v.streamId.length <= 512;
    case 'offscreen:stopCapture':
      return true;
    default:
      return false;
  }
}

export function isOffscreenResponse(value: unknown): value is OffscreenResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== 'boolean') return false;
  if (v.ok === true) return true;
  return typeof v.code === 'string' && typeof v.message === 'string';
}

/** Offscreen -> service worker events (capture ended out from under us). */
export type OffscreenEvent = { type: 'offscreen:captureEnded'; reason: string };

export function isOffscreenEvent(value: unknown): value is OffscreenEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'offscreen:captureEnded' && typeof v.reason === 'string';
}

/** Service worker -> popup state broadcast (via storage.onChanged). */
export const SESSION_STATE_KEY = 'sessionState';
