/**
 * RemoteTab service worker: owns session state, the enable/stop lifecycle,
 * capture coordination, and message routing between popup and the offscreen
 * media host (issues #005–#006; WebRTC/input arrive in #007/#009).
 *
 * MV3 note: the SW can be killed at any time. On every wake we reconcile the
 * persisted session state — an active-looking state without a live session
 * fails closed to idle.
 */

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  isOffscreenEvent,
  isOffscreenResponse,
  isPopupRequest,
  type OffscreenRequest,
  type OffscreenResponse,
  type StateResponse,
} from '@/messages.ts';
import {
  isRemoteModeActive,
  reconcileAfterRestart,
  type SessionState,
  transition,
} from '@/session-state.ts';
import { ChromeSessionStore } from '@/session-store.ts';
import { isCapturableUrl } from '@/tabs.ts';

export default defineBackground(() => {
  const store = new ChromeSessionStore(browser.storage.session);

  // -------------------------------------------------------------------------
  // Offscreen document lifecycle
  // -------------------------------------------------------------------------

  async function ensureOffscreenDocument(): Promise<void> {
    const contexts = await browser.runtime.getContexts({
      contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) return;
    await browser.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Host the captured tab stream for the active RemoteTab session.',
    });
  }

  async function closeOffscreenDocument(): Promise<void> {
    try {
      const contexts = await browser.runtime.getContexts({
        contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
      });
      if (contexts.length === 0) return;
      await browser.offscreen.closeDocument();
    } catch (err) {
      // An already-closing document is not fatal; never hide real errors.
      console.warn(
        'remotetab: offscreen close skipped',
        err instanceof Error ? err.name : 'unknown',
      );
    }
  }

  function sendToOffscreen(
    request: OffscreenRequest,
    timeoutMs = 8000,
  ): Promise<OffscreenResponse> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          ok: false,
          code: 'CAPTURE_NOT_ACTIVE',
          message: 'The capture host did not respond.',
        });
      }, timeoutMs);
      browser.runtime
        .sendMessage(request)
        .then((resp: unknown) => {
          clearTimeout(timer);
          if (isOffscreenResponse(resp)) resolve(resp);
          else
            resolve({
              ok: false,
              code: 'CAPTURE_NOT_ACTIVE',
              message: 'The capture host replied unexpectedly.',
            });
        })
        .catch(() => {
          clearTimeout(timer);
          resolve({
            ok: false,
            code: 'CAPTURE_NOT_ACTIVE',
            message: 'The capture host is unavailable.',
          });
        });
    });
  }

  // -------------------------------------------------------------------------
  // Enable / stop lifecycle
  // -------------------------------------------------------------------------

  async function enableRemote(tabId: number, streamId: string): Promise<StateResponse> {
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

    const enabled = transition(current, { type: 'enable', tabId, nowMs: Date.now() });
    await store.save(enabled);

    try {
      await ensureOffscreenDocument();
    } catch {
      return await failCapture(
        enabled,
        'CAPTURE_NOT_ACTIVE',
        'RemoteTab could not start its capture host.',
      );
    }

    const resp = await sendToOffscreen({ type: 'offscreen:startCapture', streamId });
    if (!resp.ok) {
      return await failCapture(enabled, resp.code, resp.message);
    }

    const active = transition(enabled, { type: 'capture-active', nowMs: Date.now() });
    await store.save(active);
    return { ok: true, state: active };
  }

  /** Fail closed: capture errors tear the whole session down. */
  async function failCapture(
    from: SessionState,
    code: string,
    message: string,
  ): Promise<StateResponse> {
    const failed = transition(from, { type: 'capture-failed', code, message, nowMs: Date.now() });
    const stopped = transition(failed, { type: 'stopped', nowMs: Date.now() });
    await store.save(stopped);
    void closeOffscreenDocument();
    return { ok: false, error: { code, message } };
  }

  /** Central stop path for #006: capture + offscreen + state. Extended by #012. */
  async function stopRemote(reason: 'user' | 'target-closed'): Promise<StateResponse> {
    const current = await store.load();
    await sendToOffscreen({ type: 'offscreen:stopCapture' }, 3000);
    await closeOffscreenDocument();
    const stopped = transition(current, { type: 'stopped', nowMs: Date.now() });
    await store.save(stopped);
    if (reason === 'target-closed') {
      return {
        ok: true,
        state: {
          ...stopped,
          error: {
            code: 'TARGET_TAB_CLOSED',
            message: 'Remote tab was closed. Remote Mode stopped.',
          },
        },
      };
    }
    return { ok: true, state: stopped };
  }

  // -------------------------------------------------------------------------
  // Message routing
  // -------------------------------------------------------------------------

  browser.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse: (resp: StateResponse) => void) => {
      if (isPopupRequest(raw)) {
        switch (raw.type) {
          case 'getState':
            void store.load().then((state) => sendResponse({ ok: true, state }));
            return true;
          case 'enableRemote':
            void enableRemote(raw.tabId, raw.streamId).then(sendResponse);
            return true;
          case 'stopRemote':
            void stopRemote('user').then(sendResponse);
            return true;
        }
        return false;
      }
      if (isOffscreenEvent(raw)) {
        if (raw.type === 'offscreen:captureEnded') {
          void store.load().then(async (state) => {
            if (state.capture !== 'active' && state.capture !== 'starting') return;
            await failCapture(
              state,
              'CAPTURE_NOT_ACTIVE',
              'Tab capture ended unexpectedly. Remote Mode stopped.',
            );
          });
        }
        return false;
      }
      return false;
    },
  );

  // -------------------------------------------------------------------------
  // Target tab lifecycle
  // -------------------------------------------------------------------------

  browser.tabs.onRemoved.addListener((closedTabId) => {
    void store.load().then(async (state) => {
      if (state.targetTabId !== closedTabId) return;
      await stopRemote('target-closed');
    });
  });

  // Navigation keeps the same capture stream; re-arming on navigation would
  // risk duplicate tracks, so there is deliberately no onUpdated handler.

  // -------------------------------------------------------------------------
  // SW wake-up: reconcile stale session state (fail closed)
  // -------------------------------------------------------------------------

  void store.load().then(async (state: SessionState) => {
    const reconciled = reconcileAfterRestart(state, Date.now());
    if (reconciled.phase !== state.phase) {
      // The capture host died with the old SW context; clear leftovers.
      void closeOffscreenDocument();
      await store.save(reconciled);
    }
  });
});
