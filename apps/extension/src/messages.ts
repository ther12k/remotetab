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
  | { type: 'stopRemote' }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; signalingUrl: string; iceUrls: string[] };

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
    case 'getSettings':
      return true;
    case 'saveSettings':
      return (
        typeof v.signalingUrl === 'string' &&
        /^wss?:\/\/.+/.test(v.signalingUrl) &&
        Array.isArray(v.iceUrls) &&
        v.iceUrls.length <= 16 &&
        v.iceUrls.every((u) => typeof u === 'string')
      );
    default:
      return false;
  }
}

export type SettingsPayload = {
  signalingUrl: string;
  iceUrls: string[];
};

export type SettingsResponse =
  | { ok: true; settings: SettingsPayload; deviceId: string }
  | { ok: false; error: { code: string; message: string } };

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

/** Service worker -> offscreen sender-session requests (#007). */
export type IceServerLike = { urls: string | string[] };

export type SenderRequest =
  | { type: 'sender:startSession'; sessionId: string; iceServers: IceServerLike[] }
  | { type: 'sender:applyAnswer'; sessionId: string; answerType: string; sdp: string }
  | {
      type: 'sender:addIceCandidate';
      sessionId: string;
      candidate: {
        candidate: string;
        sdpMid: string | null;
        sdpMLineIndex: number | null;
        usernameFragment: string | null;
      } | null;
    }
  | { type: 'sender:stopSession'; sessionId: string };

export type IceCandidateInitLike = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

export function isIceCandidateInitLike(value: unknown): value is IceCandidateInitLike | null {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.candidate === 'string';
}

export function isSenderRequest(value: unknown): value is SenderRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'sender:startSession':
      return (
        typeof v.sessionId === 'string' &&
        v.sessionId.length >= 8 &&
        Array.isArray(v.iceServers) &&
        v.iceServers.every((s) => {
          if (typeof s !== 'object' || s === null) return false;
          const urls = (s as { urls?: unknown }).urls;
          return (
            typeof urls === 'string' ||
            (Array.isArray(urls) && urls.every((u) => typeof u === 'string'))
          );
        })
      );
    case 'sender:applyAnswer':
      return (
        typeof v.sessionId === 'string' &&
        (v.answerType === 'answer' || v.answerType === 'pranswer') &&
        typeof v.sdp === 'string' &&
        v.sdp.length > 0
      );
    case 'sender:addIceCandidate':
      return typeof v.sessionId === 'string' && isIceCandidateInitLike(v.candidate);
    case 'sender:stopSession':
      return typeof v.sessionId === 'string';
    default:
      return false;
  }
}

/** Offscreen sender-session -> service worker events. */
export type SenderEvent =
  | { type: 'sender:offer'; sessionId: string; sdp: string }
  | { type: 'sender:ice'; sessionId: string; candidate: IceCandidateInitLike | null }
  | { type: 'sender:peerState'; sessionId: string; state: string; detail?: string }
  | { type: 'sender:channelState'; sessionId: string; open: boolean }
  | { type: 'sender:controlFrame'; sessionId: string; raw: string }
  | { type: 'sender:protocolViolation'; sessionId: string; code: string };

export function isSenderEvent(value: unknown): value is SenderEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.sessionId !== 'string') return false;
  switch (v.type) {
    case 'sender:offer':
      return typeof v.sdp === 'string' && v.sdp.length > 0;
    case 'sender:ice':
      return isIceCandidateInitLike(v.candidate);
    case 'sender:peerState':
      return typeof v.state === 'string';
    case 'sender:channelState':
      return typeof v.open === 'boolean';
    case 'sender:controlFrame':
      return typeof v.raw === 'string' && v.raw.length <= 16_384;
    case 'sender:protocolViolation':
      return typeof v.code === 'string';
    default:
      return false;
  }
}
