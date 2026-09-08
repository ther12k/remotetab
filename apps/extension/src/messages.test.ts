/**
 * Contract test: EVERY member of PopupRequest must pass its own validator,
 * and structurally invalid instances must be rejected. A validator that
 * rejects legitimate requests silently breaks the popup before any
 * background logic runs (audit issue #21).
 */

import { describe, expect, it } from 'vitest';

import {
  isOffscreenEvent,
  isOffscreenRequest,
  isPopupRequest,
  isSenderEvent,
  type PopupRequest,
} from './messages.ts';

/** One valid instance per PopupRequest member — keep in sync with the type. */
const VALID_POPUP_REQUESTS: PopupRequest[] = [
  { type: 'getState' },
  { type: 'enableRemote', tabId: 42, streamId: 'stream-1' },
  { type: 'stopRemote' },
  { type: 'getSettings' },
  {
    type: 'saveSettings',
    signalingUrl: 'wss://signal.example.com/ws',
    iceUrls: ['stun:stun.example.com'],
  },
  { type: 'pairStart' },
  { type: 'pairCancel' },
  { type: 'pairedList' },
  { type: 'revokeDevice', deviceId: 'dev_abcdefgh' },
];

describe('isPopupRequest contract', () => {
  it('accepts every PopupRequest member', () => {
    for (const req of VALID_POPUP_REQUESTS) {
      expect(isPopupRequest(req), `must accept ${req.type}`).toBe(true);
    }
  });

  it('accepts pairStart/pairCancel/pairedList with no extra fields', () => {
    expect(isPopupRequest({ type: 'pairStart' })).toBe(true);
    expect(isPopupRequest({ type: 'pairCancel' })).toBe(true);
    expect(isPopupRequest({ type: 'pairedList' })).toBe(true);
  });

  it('rejects revokeDevice without a usable deviceId', () => {
    expect(isPopupRequest({ type: 'revokeDevice' })).toBe(false);
    expect(isPopupRequest({ type: 'revokeDevice', deviceId: 'short' })).toBe(false);
    expect(isPopupRequest({ type: 'revokeDevice', deviceId: 123 })).toBe(false);
  });

  it('rejects unknown types and malformed envelopes', () => {
    expect(isPopupRequest({ type: 'nope' })).toBe(false);
    expect(isPopupRequest(null)).toBe(false);
    expect(isPopupRequest('enableRemote')).toBe(false);
    expect(isPopupRequest({})).toBe(false);
  });

  it('rejects malformed field values per member', () => {
    expect(isPopupRequest({ type: 'enableRemote', tabId: 0, streamId: 's' })).toBe(false);
    expect(isPopupRequest({ type: 'enableRemote', tabId: 1.5, streamId: 's' })).toBe(false);
    expect(isPopupRequest({ type: 'enableRemote', tabId: 1, streamId: '' })).toBe(false);
    expect(isPopupRequest({ type: 'saveSettings', signalingUrl: 'ftp://x', iceUrls: [] })).toBe(
      false,
    );
    expect(
      isPopupRequest({ type: 'saveSettings', signalingUrl: 'wss://x', iceUrls: 'stun:x' }),
    ).toBe(false);
    expect(isPopupRequest({ type: 'saveSettings', signalingUrl: 'wss://x', iceUrls: [1] })).toBe(
      false,
    );
  });
});

describe('offscreen + sender contracts', () => {
  it('offscreen requests round-trip', () => {
    expect(isOffscreenRequest({ type: 'offscreen:startCapture', streamId: 's' })).toBe(true);
    expect(isOffscreenRequest({ type: 'offscreen:stopCapture' })).toBe(true);
    expect(isOffscreenRequest({ type: 'offscreen:startCapture' })).toBe(false);
  });

  it('offscreen events validate the reason field', () => {
    expect(isOffscreenEvent({ type: 'offscreen:captureEnded', reason: 'tab-closed' })).toBe(true);
    expect(isOffscreenEvent({ type: 'offscreen:captureEnded' })).toBe(false);
  });

  it('sender events validate sessionId', () => {
    expect(isSenderEvent({ type: 'sender:offer', sessionId: 'sess_x', sdp: 'v=0' })).toBe(true);
    expect(isSenderEvent({ type: 'sender:offer', sdp: 'v=0' })).toBe(false);
  });
});
