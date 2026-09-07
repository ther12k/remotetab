import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  isInputAllowed,
  isRemoteModeActive,
  reconcileAfterRestart,
  type SessionState,
  transition,
} from './session-state.ts';

const NOW = 1_000;

describe('session state transitions', () => {
  it('starts idle', () => {
    expect(INITIAL_STATE.phase).toBe('idle');
    expect(INITIAL_STATE.targetTabId).toBeNull();
  });

  it('enable binds the target tab, clears errors, starts capture', () => {
    const failing: SessionState = { ...INITIAL_STATE, error: { code: 'X', message: 'x' } };
    const next = transition(failing, { type: 'enable', tabId: 42, nowMs: NOW });
    expect(next.phase).toBe('enabled');
    expect(next.capture).toBe('starting');
    expect(next.targetTabId).toBe(42);
    expect(next.error).toBeNull();
    expect(next.sinceMs).toBe(NOW);
  });

  it('tracks the capture lifecycle', () => {
    let state = transition(INITIAL_STATE, { type: 'enable', tabId: 9, nowMs: NOW });
    state = transition(state, { type: 'capture-active', nowMs: NOW });
    expect(state.capture).toBe('active');
    expect(state.phase).toBe('enabled');
    state = transition(state, {
      type: 'capture-failed',
      code: 'CAPTURE_NOT_ACTIVE',
      message: 'Capture ended.',
      nowMs: NOW,
    });
    expect(state.capture).toBe('error');
    expect(state.phase).toBe('stopping');
  });

  it('walks the documented happy path', () => {
    const steps = ['signaling', 'peer-connected', 'authenticating', 'remote-active'] as const;
    let state = transition(INITIAL_STATE, { type: 'enable', tabId: 1, nowMs: NOW });
    for (const step of steps) {
      state = transition(state, { type: step, nowMs: NOW + 1 });
      expect(state.phase).toBe(step);
    }
  });

  it('stop and stopped land in idle and drop the target', () => {
    let state = transition(INITIAL_STATE, { type: 'enable', tabId: 7, nowMs: NOW });
    state = transition(state, { type: 'stop', reason: 'user', nowMs: NOW });
    expect(state.phase).toBe('stopping');
    state = transition(state, { type: 'stopped', nowMs: NOW });
    expect(state.phase).toBe('idle');
    expect(state.targetTabId).toBeNull();
  });

  it('fail closes toward stopping and records a readable error', () => {
    let state = transition(INITIAL_STATE, { type: 'enable', tabId: 7, nowMs: NOW });
    state = transition(state, {
      type: 'fail',
      code: 'PEER_AUTH_FAILED',
      message: 'Peer proof failed.',
      nowMs: NOW,
    });
    expect(state.phase).toBe('stopping');
    expect(state.error?.code).toBe('PEER_AUTH_FAILED');
    expect(state.error?.message).not.toMatch(/Error|stack/i);
  });

  it('stopped is idempotent from idle', () => {
    const next = transition(INITIAL_STATE, { type: 'stopped', nowMs: NOW });
    expect(next).toEqual({ ...INITIAL_STATE, sinceMs: NOW });
  });
});

describe('gates', () => {
  it('input is only allowed while remote-active', () => {
    expect(isInputAllowed('remote-active')).toBe(true);
    for (const phase of [
      'idle',
      'enabled',
      'signaling',
      'peer-connected',
      'authenticating',
      'reconnecting',
      'stopping',
    ] as const) {
      expect(isInputAllowed(phase)).toBe(false);
    }
  });

  it('stop is visible whenever remote mode is on', () => {
    for (const phase of [
      'enabled',
      'signaling',
      'peer-connected',
      'authenticating',
      'remote-active',
      'reconnecting',
      'stopping',
    ] as const) {
      expect(isRemoteModeActive(phase)).toBe(true);
    }
    expect(isRemoteModeActive('idle')).toBe(false);
  });
});

describe('reconcile after restart', () => {
  it('keeps idle untouched', () => {
    expect(reconcileAfterRestart(INITIAL_STATE, NOW)).toBe(INITIAL_STATE);
  });

  it('forces every active-looking phase back to idle', () => {
    for (const phase of [
      'enabled',
      'signaling',
      'peer-connected',
      'authenticating',
      'remote-active',
      'reconnecting',
      'stopping',
    ] as const) {
      const state: SessionState = {
        phase,
        capture: 'active',
        targetTabId: 5,
        error: null,
        sinceMs: NOW,
      };
      const reconciled = reconcileAfterRestart(state, NOW);
      expect(reconciled.phase).toBe('idle');
      expect(reconciled.targetTabId).toBeNull();
    }
  });
});
