/**
 * RemoteTab service worker: owns session state, the enable/stop lifecycle,
 * capture coordination, signaling, and relaying between the offscreen WebRTC
 * sender and the signaling service (issues #005–#007; CDP input is #009).
 *
 * MV3 note: the SW can be killed at any time. On every wake we reconcile the
 * persisted session state — an active-looking state without a live session
 * fails closed to idle.
 */

import {
  newSessionId,
  type SignalingMessage,
  sessionAcceptedSchema,
  sessionCloseSchema,
  sessionRequestSchema,
  signalAnswerSchema,
  signalIceSchema,
  signalingFrame,
} from '@remotetab/protocol';
import { DEFAULT_ICE_SERVERS, toIceServers } from '@remotetab/webrtc';
import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { CdpInputAdapter } from '@/cdp-input.ts';
import { DeviceIdentityStore } from '@/device.ts';
import { type ControlSender, InputService } from '@/input-service.ts';
import {
  isOffscreenEvent,
  isOffscreenRequest,
  isOffscreenResponse,
  isPopupRequest,
  isSenderEvent,
  type OffscreenRequest,
  type OffscreenResponse,
  type SenderEvent,
  type SenderRequest,
  type StateResponse,
} from '@/messages.ts';
import { ChromePowerAdapter } from '@/power-adapter.ts';
import type { SessionError } from '@/session-state.ts';
import {
  isRemoteModeActive,
  reconcileAfterRestart,
  type SessionState,
  transition,
} from '@/session-state.ts';
import { ChromeSessionStore } from '@/session-store.ts';
import { SettingsStore } from '@/settings.ts';
import { SignalingClient, type SignalingState } from '@/signaling-client.ts';
import { isCapturableUrl } from '@/tabs.ts';
import { TeardownOrchestrator, type TeardownStep } from '@/teardown.ts';

export default defineBackground(() => {
  const store = new ChromeSessionStore(browser.storage.session);
  const settingsStore = new SettingsStore(browser.storage.local);
  const deviceStore = new DeviceIdentityStore(browser.storage.local);

  /** The one live WebRTC session being relayed (ephemeral, never persisted). */
  let activeSessionId: string | null = null;
  let signaling: SignalingClient | null = null;
  let signalingState: SignalingState = 'offline';
  const power = new ChromePowerAdapter();
  /** One teardown pass per Remote Mode lifecycle; rebuilt at enable. */
  let teardown: TeardownOrchestrator | null = null;

  // Narrow input authority: the ONLY path from peer frames to CDP.
  const inputService = new InputService(new CdpInputAdapter(), {
    send(raw: string): boolean {
      if (activeSessionId === null) return false;
      void sendToOffscreen({ type: 'sender:sendControl', sessionId: activeSessionId, raw });
      return true;
    },
  } satisfies ControlSender);

  // A debugger detach (DevTools opened on the tab, crash, etc.) must never
  // leave input armed (fail closed).
  browser.debugger.onDetach.addListener((source) => {
    void (async () => {
      if (activeSessionId !== null) await inputService.stop();
      void source;
      await teardownSession();
    })();
  });

  // -------------------------------------------------------------------------
  // Offscreen document lifecycle (#006)
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
    request: OffscreenRequest | SenderRequest,
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
  // Signaling session flow (#007)
  // -------------------------------------------------------------------------

  async function startSignaling(): Promise<void> {
    const [settings, identity] = await Promise.all([
      settingsStore.load(),
      deviceStore.loadOrCreate(),
    ]);
    const servers =
      settings.iceUrls.length > 0 ? toIceServers(settings.iceUrls) : DEFAULT_ICE_SERVERS;

    signaling?.close();
    const client = new SignalingClient({
      url: settings.signalingUrl,
      hello: { role: 'desktop', deviceId: identity.deviceId, displayName: identity.displayName },
      onState: (state) => {
        signalingState = state;
        void updateSignalingPhase(state);
      },
      onFrame: (frame) => void handleSignalingFrame(frame, identity.deviceId, servers),
    });
    signaling = client;
    client.connect();
  }

  function stopSignaling(): void {
    signaling?.close();
    signaling = null;
    signalingState = 'offline';
  }

  /** Map signaling health onto the session phase (fail closed). */
  async function updateSignalingPhase(state: SignalingState): Promise<void> {
    const current = await store.load();
    if (state === 'online') {
      if (current.phase === 'enabled') {
        await store.save(transition(current, { type: 'signaling', nowMs: Date.now() }));
      }
      return;
    }
    if (
      current.phase === 'peer-connected' ||
      current.phase === 'authenticating' ||
      current.phase === 'remote-active'
    ) {
      await store.save(transition(current, { type: 'reconnecting', nowMs: Date.now() }));
    }
  }

  async function handleSignalingFrame(
    frame: SignalingMessage,
    desktopDeviceId: string,
    servers: RTCIceServer[],
  ): Promise<void> {
    const state = await store.load();
    switch (frame.type) {
      case 'session.request': {
        const req = sessionRequestSchema.parse(frame.payload);
        // M1 vertical slice: auto-accept while capturing, one session at a
        // time. Pairing + peer auth (#013/#014) gate this before release.
        if (state.capture !== 'active' || activeSessionId !== null) {
          signaling?.send(signalingFrame('session.rejected', { code: 'SESSION_CONFLICT' }));
          return;
        }
        const sessionId = newSessionId();
        const accepted = sessionAcceptedSchema.parse({
          sessionId,
          desktopDeviceId,
          phoneDeviceId: req.deviceId,
        });
        activeSessionId = sessionId;
        await store.save(transition(state, { type: 'peer-connected', nowMs: Date.now() }));
        signaling?.send(signalingFrame('session.accepted', accepted));
        await sendToOffscreen(
          { type: 'sender:startSession', sessionId, iceServers: servers },
          8000,
        );
        return;
      }
      case 'signal.answer': {
        const answer = signalAnswerSchema.parse(frame.payload);
        if (answer.sessionId !== activeSessionId) return;
        await sendToOffscreen({
          type: 'sender:applyAnswer',
          sessionId: answer.sessionId,
          answerType: 'answer',
          sdp: answer.sdp,
        });
        return;
      }
      case 'signal.ice': {
        const ice = signalIceSchema.parse(frame.payload);
        if (ice.sessionId !== activeSessionId || !ice.candidate) return;
        await sendToOffscreen({
          type: 'sender:addIceCandidate',
          sessionId: ice.sessionId,
          candidate: {
            candidate: ice.candidate,
            sdpMid: ice.sdpMid,
            sdpMLineIndex: ice.sdpMLineIndex,
            usernameFragment: ice.usernameFragment,
          },
        });
        return;
      }
      case 'session.close': {
        const close = sessionCloseSchema.parse(frame.payload);
        if (close.sessionId !== activeSessionId) return;
        await teardownSession();
        return;
      }
      default:
        return;
    }
  }

  async function handleSenderEvent(event: SenderEvent): Promise<void> {
    if (event.sessionId !== activeSessionId) return;
    const state = await store.load();
    switch (event.type) {
      case 'sender:offer':
        signaling?.send(
          signalingFrame('signal.offer', { sessionId: event.sessionId, sdp: event.sdp }),
        );
        return;
      case 'sender:ice': {
        const candidate = event.candidate;
        if (!candidate) return;
        signaling?.send(
          signalingFrame('signal.ice', {
            sessionId: event.sessionId,
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            usernameFragment: candidate.usernameFragment,
          }),
        );
        return;
      }
      case 'sender:peerState':
        if (event.state === 'connected') {
          await store.save(transition(state, { type: 'peer-connected', nowMs: Date.now() }));
        } else if (
          event.state === 'failed' ||
          event.state === 'no-track' ||
          event.state === 'offer-failed'
        ) {
          await teardownSession();
        } else if (event.state === 'disconnected' || event.state === 'closed') {
          if (isRemoteModeActive(state.phase)) {
            await store.save(transition(state, { type: 'reconnecting', nowMs: Date.now() }));
          }
        }
        return;
      case 'sender:channelState':
        if (event.open && state.phase === 'peer-connected') {
          // M1 vertical slice: control open → remote-active. Peer auth
          // (#014) will gate this transition before any release.
          await store.save(transition(state, { type: 'remote-active', nowMs: Date.now() }));
          try {
            if (state.targetTabId !== null) {
              await inputService.start(event.sessionId, state.targetTabId);
            }
          } catch (err) {
            // Fail closed: input that cannot attach ends Remote Mode with a
            // readable message instead of staying half-armed.
            const message =
              err instanceof Error ? err.message : 'Remote input could not attach to this tab.';
            const failed = transition(state, {
              type: 'fail',
              code: 'INPUT_NOT_ATTACHED',
              message,
              nowMs: Date.now(),
            });
            const stopped = transition(failed, { type: 'stopped', nowMs: Date.now() });
            await store.save(stopped);
            stopSignaling();
            void closeOffscreenDocument();
          }
        } else if (!event.open && state.phase === 'remote-active') {
          await store.save(transition(state, { type: 'reconnecting', nowMs: Date.now() }));
        }
        return;
      case 'sender:controlFrame': {
        // Single authority path: validate + gate + dispatch through the
        // narrow adapter. Frames were schema-validated in the offscreen doc
        // and are re-checked here.
        const current = await store.load();
        const result = await inputService.handleFrame(
          event.sessionId,
          event.raw,
          current.phase,
          current.targetTabId,
        );
        if (
          !result.ok &&
          (result.code === 'REPLAY_REJECTED' || result.code === 'MESSAGE_INVALID')
        ) {
          // Protocol abuse → tear the session down (fail closed).
          await teardownSession();
        }
        return;
      }
      case 'sender:protocolViolation':
        await teardownSession();
        return;
    }
  }

  /** Tear the WebRTC session down while keeping Remote Mode enabled. */
  async function teardownSession(): Promise<void> {
    if (activeSessionId) {
      await sendToOffscreen({ type: 'sender:stopSession', sessionId: activeSessionId }, 3000);
    }
    await inputService.stop();
    // (keep-awake stays: Remote Mode itself is still on)
    activeSessionId = null;
    const state = await store.load();
    if (state.phase !== 'enabled' && state.phase !== 'idle') {
      await store.save(transition(state, { type: 'signaling', nowMs: Date.now() }));
    }
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
    teardown = null; // fresh teardown pass for this Remote Mode lifecycle
    teardown = null; // fresh teardown pass for this Remote Mode lifecycle

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
    // Keep the system awake only while Remote Mode is active (ADR-011).
    power.requestSystem();
    // Keep the system awake only while Remote Mode is active (ADR-011).
    power.requestSystem();

    // Go online so a phone can find this desktop. Connection problems are
    // recoverable — the client reconnects with backoff while Remote Mode is on.
    void startSignaling();
    return { ok: true, state: active };
  }

  /** Build ONE ordered, fail-safe teardown pass (issue #012). */
  function buildTeardown(): TeardownOrchestrator {
    const steps: TeardownStep[] = [
      { name: 'input', run: () => inputService.stop() },
      {
        name: 'peer',
        run: async () => {
          if (activeSessionId !== null) {
            await sendToOffscreen({ type: 'sender:stopSession', sessionId: activeSessionId }, 3000);
          }
        },
      },
      { name: 'signaling', run: async () => stopSignaling() },
      {
        name: 'capture',
        run: async () => {
          await sendToOffscreen({ type: 'offscreen:stopCapture' }, 3000);
        },
      },
      { name: 'power', run: async () => power.release() },
      { name: 'offscreen', run: () => closeOffscreenDocument() },
      {
        name: 'state',
        run: async () => {
          activeSessionId = null;
          const current = await store.load();
          const stopped = transition(current, { type: 'stopped', nowMs: Date.now() });
          await store.save(stopped);
        },
      },
    ];
    return new TeardownOrchestrator(steps);
  }

  /** Central stop: input, peer, signaling, capture, power, offscreen, state. */
  async function stopRemoteSession(
    reason: 'user' | 'target-closed',
    error?: SessionError,
  ): Promise<StateResponse> {
    void reason;
    const orchestrator = teardown ?? buildTeardown();
    teardown = orchestrator;
    const report = await orchestrator.run();
    if (report.failed.length > 0) {
      console.warn(
        'remotetab: teardown steps failed',
        report.failed.map((f) => f.name),
      );
    }
    const state = await store.load();
    if (error) {
      return { ok: true, state: { ...state, error } };
    }
    return { ok: true, state };
  }

  /** Fail closed: capture errors tear the whole Remote Mode down. */
  async function failCapture(
    from: SessionState,
    code: string,
    message: string,
  ): Promise<StateResponse> {
    transition(from, { type: 'capture-failed', code, message, nowMs: Date.now() });
    return stopRemoteSession('user', { code, message });
  }

  // -------------------------------------------------------------------------
  // Message routing
  // -------------------------------------------------------------------------

  browser.runtime.onMessage.addListener(
    (
      raw: unknown,
      _sender,
      sendResponse: (
        resp: StateResponse | { ok: true; settings: unknown; deviceId: string },
      ) => void,
    ) => {
      if (isPopupRequest(raw)) {
        switch (raw.type) {
          case 'getState':
            void store.load().then((state) => sendResponse({ ok: true, state }));
            return true;
          case 'enableRemote':
            void enableRemote(raw.tabId, raw.streamId).then(sendResponse);
            return true;
          case 'stopRemote':
            void stopRemoteSession('user').then(sendResponse);
            return true;
          case 'getSettings':
            void Promise.all([settingsStore.load(), deviceStore.loadOrCreate()]).then(
              ([settings, identity]) =>
                sendResponse({ ok: true, settings, deviceId: identity.deviceId }),
            );
            return true;
          case 'saveSettings':
            void settingsStore
              .save({ signalingUrl: raw.signalingUrl, iceUrls: raw.iceUrls })
              .then(() => settingsStore.load())
              .then((settings) =>
                deviceStore
                  .loadOrCreate()
                  .then((identity) =>
                    sendResponse({ ok: true, settings, deviceId: identity.deviceId }),
                  ),
              )
              .catch((err: unknown) =>
                sendResponse({
                  ok: false,
                  error: {
                    code: 'MESSAGE_INVALID',
                    message:
                      err instanceof Error && err.message.startsWith('invalid')
                        ? err.message
                        : 'Settings could not be saved.',
                  },
                }),
              );
            return true;
        }
        return false;
      }
      if (isOffscreenRequest(raw)) return false; // for the offscreen document
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
      if (isSenderEvent(raw)) {
        void handleSenderEvent(raw);
        return false;
      }
      return false;
    },
  );

  browser.tabs.onRemoved.addListener((closedTabId) => {
    void store.load().then(async (state) => {
      if (state.targetTabId !== closedTabId) return;
      await stopRemoteSession('target-closed', {
        code: 'TARGET_TAB_CLOSED',
        message: 'Remote tab was closed. Remote Mode stopped.',
      });
    });
  });

  // SW wake-up: reconcile stale session state (fail closed).
  void store.load().then(async (state: SessionState) => {
    const reconciled = reconcileAfterRestart(state, Date.now());
    if (reconciled.phase !== state.phase) {
      // The capture host died with the old SW context; clear leftovers.
      // Keep-awake must not outlive Remote Mode either (release defensively).
      try {
        power.release();
      } catch {
        // No live power context — nothing to release.
      }
      void closeOffscreenDocument();
      await store.save(reconciled);
    }
  });

  // Keep the signaling state symbol referenced for diagnostics logging.
  void signalingState;
});
