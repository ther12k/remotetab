/**
 * RemoteTab session state — owned by the service worker, persisted in
 * chrome.storage.session (never written to disk, cleared on browser exit).
 *
 * Laptop state machine (ARCHITECTURE.md §11):
 *   IDLE -> ENABLED -> SIGNALING -> PEER_CONNECTED -> AUTHENTICATING
 *        -> REMOTE_ACTIVE -> RECONNECTING -> STOPPING -> IDLE
 * Any failure path funnels into STOPPING -> IDLE (fail closed).
 *
 * `capture` tracks the selected-tab MediaStream lifecycle independently of
 * the peer phase: capture can be active while still waiting for a peer.
 */

export const SESSION_PHASES = [
  'idle',
  'enabled',
  'signaling',
  'peer-connected',
  'authenticating',
  'remote-active',
  'reconnecting',
  'stopping',
] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

export const CAPTURE_PHASES = ['idle', 'starting', 'active', 'error'] as const;
export type CapturePhase = (typeof CAPTURE_PHASES)[number];

export type SessionError = {
  code: string;
  /** User-readable message; never includes raw exception text or page content. */
  message: string;
};

export type SessionState = {
  phase: SessionPhase;
  capture: CapturePhase;
  /** The one selected tab RemoteTab is attached to (null when idle). */
  targetTabId: number | null;
  error: SessionError | null;
  /** Epoch ms of the last transition (diagnostics only). */
  sinceMs: number;
};

export const INITIAL_STATE: SessionState = {
  phase: 'idle',
  capture: 'idle',
  targetTabId: null,
  error: null,
  sinceMs: 0,
};

export type SessionEvent =
  | { type: 'enable'; tabId: number; nowMs: number }
  | { type: 'capture-starting'; nowMs: number }
  | { type: 'capture-active'; nowMs: number }
  | { type: 'capture-failed'; code: string; message: string; nowMs: number }
  | { type: 'signaling'; nowMs: number }
  | { type: 'peer-connected'; nowMs: number }
  | { type: 'authenticating'; nowMs: number }
  | { type: 'remote-active'; nowMs: number }
  | { type: 'reconnecting'; nowMs: number }
  | {
      type: 'stop';
      reason: 'user' | 'error' | 'target-closed' | 'protocol-violation';
      nowMs: number;
    }
  | { type: 'stopped'; nowMs: number }
  | { type: 'fail'; code: string; message: string; nowMs: number };

/** Phases in which Remote Mode is considered "on" (Stop must be visible). */
export function isRemoteModeActive(phase: SessionPhase): boolean {
  return phase !== 'idle';
}

/** Phases in which remote input may be dispatched to the tab. */
export function isInputAllowed(phase: SessionPhase): boolean {
  return phase === 'remote-active';
}

/** Pure state transition — unit tested, no chrome.* dependency. */
export function transition(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'enable':
      return {
        phase: 'enabled',
        capture: 'starting',
        targetTabId: event.tabId,
        error: null,
        sinceMs: event.nowMs,
      };
    case 'capture-starting':
      return { ...state, capture: 'starting', error: null, sinceMs: event.nowMs };
    case 'capture-active':
      return { ...state, capture: 'active', error: null, sinceMs: event.nowMs };
    case 'capture-failed':
      return {
        ...state,
        phase: 'stopping',
        capture: 'error',
        error: { code: event.code, message: event.message },
        sinceMs: event.nowMs,
      };
    case 'signaling':
      return { ...state, phase: 'signaling', error: null, sinceMs: event.nowMs };
    case 'peer-connected':
      return { ...state, phase: 'peer-connected', error: null, sinceMs: event.nowMs };
    case 'authenticating':
      return { ...state, phase: 'authenticating', error: null, sinceMs: event.nowMs };
    case 'remote-active':
      return { ...state, phase: 'remote-active', error: null, sinceMs: event.nowMs };
    case 'reconnecting':
      return { ...state, phase: 'reconnecting', error: null, sinceMs: event.nowMs };
    case 'stop':
      return { ...state, phase: 'stopping', error: null, sinceMs: event.nowMs };
    case 'stopped':
      return {
        phase: 'idle',
        capture: 'idle',
        targetTabId: null,
        error: null,
        sinceMs: event.nowMs,
      };
    case 'fail':
      // Fail closed: surface the error and go straight to stopping.
      return {
        ...state,
        phase: 'stopping',
        error: { code: event.code, message: event.message },
        sinceMs: event.nowMs,
      };
  }
}

/**
 * Reconcile persisted state after a service-worker restart. MV3 may kill the
 * SW at any time; a state claiming an active session without a running
 * session must never survive (fail closed).
 */
export function reconcileAfterRestart(state: SessionState, nowMs: number): SessionState {
  if (state.phase === 'idle') return state;
  return transition(state, { type: 'stopped', nowMs });
}
