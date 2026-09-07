/**
 * Session state persistence via chrome.storage.session. The storage area is
 * injected so the logic stays unit-testable. Live updates are observed with
 * chrome.storage.onChanged by the UI (popup), not through this store.
 */

import { SESSION_STATE_KEY } from './messages.ts';
import { INITIAL_STATE, type SessionState } from './session-state.ts';

export interface SessionStore {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
}

interface StorageAreaLike {
  get(keys: string[] | string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isValidState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.phase === 'string' && (v.targetTabId === null || typeof v.targetTabId === 'number')
  );
}

export class ChromeSessionStore implements SessionStore {
  constructor(private readonly area: StorageAreaLike) {}

  async load(): Promise<SessionState> {
    const result = await this.area.get(SESSION_STATE_KEY);
    const raw = result[SESSION_STATE_KEY];
    return isValidState(raw) ? raw : INITIAL_STATE;
  }

  async save(state: SessionState): Promise<void> {
    await this.area.set({ [SESSION_STATE_KEY]: state });
  }
}
