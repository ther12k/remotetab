/**
 * Offscreen media host: consumes the tabCapture streamId produced by the
 * popup's user gesture and owns the MediaStream lifecycle (issues #006,
 * extended by #007 with the WebRTC sender).
 */

import { browser } from 'wxt/browser';
import { OffscreenTabCaptureAdapter } from '@/capture-adapter.ts';
import { isOffscreenRequest, type OffscreenResponse } from '@/messages.ts';

const adapter = new OffscreenTabCaptureAdapter();

adapter.onEnded(() => {
  // The track ended on its own (target tab closed, source gone). Tell the
  // service worker so it can tear the session down.
  void browser.runtime
    .sendMessage({ type: 'offscreen:captureEnded', reason: 'track-ended' })
    .catch(() => {
      // The SW may be mid-restart; it reconciles state on wake (fail closed).
    });
});

browser.runtime.onMessage.addListener(
  (raw: unknown, _sender, sendResponse: (resp: OffscreenResponse) => void) => {
    if (!isOffscreenRequest(raw)) return undefined;
    switch (raw.type) {
      case 'offscreen:startCapture':
        adapter
          .start(raw.streamId)
          .then((track) => sendResponse({ ok: true, track }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Capture failed.';
            sendResponse({ ok: false, code: 'CAPTURE_NOT_ACTIVE', message });
          });
        return true; // async sendResponse
      case 'offscreen:stopCapture':
        adapter
          .stop()
          .then(() => sendResponse({ ok: true, track: null }))
          .catch(() =>
            sendResponse({ ok: false, code: 'CAPTURE_NOT_ACTIVE', message: 'Stop failed.' }),
          );
        return true;
    }
    return undefined;
  },
);
