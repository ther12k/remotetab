/**
 * RemoteTab service worker: owns session state, the enable/stop lifecycle,
 * and routes messages between popup, offscreen media host, and (later
 * issues) capture, WebRTC, CDP input, and signaling.
 *
 * MV3 note: the SW can be killed at any time. On every wake we reconcile the
 * persisted session state — an active-looking state without a live session
 * fails closed to idle.
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { isPopupRequest, type StateResponse } from '@/messages.ts';
import { isRemoteModeActive, reconcileAfterRestart, transition } from '@/session-state.ts';
import { ChromeSessionStore } from '@/session-store.ts';
import { isCapturableUrl } from '@/tabs.ts';

export default defineBackground(() => {
  const store = new ChromeSessionStore(browser.storage.session);

  async function enableRemote(tabId: number): Promise<StateResponse> {
    const current = await store.load();
    if (isRemoteModeActive(current.phase)) {
      return {
        ok: false,
        error: {
          code: 'SESSION_CONFLICT',
          message: 'Remote Mode is already active. Stop it first.',
        },
      };
    }
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab) {
      return {
        ok: false,
        error: { code: 'TARGET_TAB_CLOSED', message: 'That tab no longer exists.' },
      };
    }
    if (!isCapturableUrl(tab.url)) {
      return {
        ok: false,
        error: {
          code: 'CAPTURE_NOT_ACTIVE',
          message: 'This page cannot be captured. Use a normal http(s) tab.',
        },
      };
    }
    const next = transition(current, { type: 'enable', tabId, nowMs: Date.now() });
    await store.save(next);
    // Capture + WebRTC wiring arrive with issues #006/#007; the state machine
    // intentionally stays in `enabled` until those land.
    return { ok: true, state: next };
  }

  async function stopRemote(): Promise<StateResponse> {
    const current = await store.load();
    // Idempotent even when already idle.
    const next = transition(current, { type: 'stop', reason: 'user', nowMs: Date.now() });
    const stopped = transition(next, { type: 'stopped', nowMs: Date.now() });
    await store.save(stopped);
    return { ok: true, state: stopped };
  }

  browser.runtime.onMessage.addListener((raw: unknown): Promise<StateResponse> | undefined => {
    if (!isPopupRequest(raw)) return undefined;
    switch (raw.type) {
      case 'getState':
        return store.load().then((state) => ({ ok: true, state }));
      case 'enableRemote':
        return enableRemote(raw.tabId);
      case 'stopRemote':
        return stopRemote();
    }
    return undefined;
  });

  // SW wake-up: reconcile stale session state (fail closed).
  void store.load().then(async (state) => {
    const reconciled = reconcileAfterRestart(state, Date.now());
    if (reconciled.phase !== state.phase) {
      await store.save(reconciled);
    }
  });
});
