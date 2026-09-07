/**
 * Popup UI (vanilla TS, no framework — keeps the privileged context lean).
 * Renders the current tab + session state and drives Enable/Stop via the
 * service worker. All Enable actions are explicit local user clicks.
 */

import { browser } from 'wxt/browser';
import { type PopupRequest, SESSION_STATE_KEY, type StateResponse } from '@/messages.ts';
import type { SessionPhase, SessionState } from '@/session-state.ts';
import { toTabDisplay } from '@/tabs.ts';

const PHASE_LABEL: Record<SessionPhase, string> = {
  idle: 'Idle',
  enabled: 'Enabled',
  signaling: 'Connecting…',
  'peer-connected': 'Peer connected',
  authenticating: 'Authenticating…',
  'remote-active': 'Remote active',
  reconnecting: 'Reconnecting…',
  stopping: 'Stopping…',
};

function sendPopupRequest(request: PopupRequest): Promise<StateResponse> {
  return browser.runtime.sendMessage(request) as Promise<StateResponse>;
}

async function refreshState(): Promise<void> {
  const res = await sendPopupRequest({ type: 'getState' });
  if (!res.ok || !res.state) return;
  render(res.state);
}

function render(state: SessionState): void {
  const phaseEl = document.getElementById('phase');
  const enableBtn = document.getElementById('enable') as HTMLButtonElement | null;
  const stopBtn = document.getElementById('stop') as HTMLButtonElement | null;
  const errorEl = document.getElementById('error');
  if (!phaseEl || !enableBtn || !stopBtn || !errorEl) return;

  const active = state.phase !== 'idle';
  phaseEl.textContent = PHASE_LABEL[state.phase];
  phaseEl.classList.toggle('active', active);
  enableBtn.hidden = active;
  stopBtn.hidden = !active;
  errorEl.textContent = state.error?.message ?? '';
}

async function refreshTab(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const titleEl = document.getElementById('tab-title');
  const originEl = document.getElementById('tab-origin');
  if (!tab || !titleEl || !originEl) return;
  const display = toTabDisplay(tab);
  if (!display) {
    titleEl.textContent = 'Unsupported tab';
    originEl.textContent = '';
    return;
  }
  titleEl.textContent = display.title;
  originEl.textContent = display.origin;
}

async function onEnable(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const errorEl = document.getElementById('error');
  if (!tab?.id) {
    if (errorEl) errorEl.textContent = 'No active tab found.';
    return;
  }
  const res = await sendPopupRequest({ type: 'enableRemote', tabId: tab.id });
  if (!res.ok && res.error && errorEl) {
    errorEl.textContent = res.error.message;
  } else if (res.state) {
    render(res.state);
  }
  void refreshState();
}

async function onStop(): Promise<void> {
  const res = await sendPopupRequest({ type: 'stopRemote' });
  if (res.state) render(res.state);
  void refreshState();
}

function main(): void {
  (document.getElementById('enable') as HTMLButtonElement | null)?.addEventListener(
    'click',
    () => void onEnable(),
  );
  (document.getElementById('stop') as HTMLButtonElement | null)?.addEventListener(
    'click',
    () => void onStop(),
  );

  // Live state updates from the service worker.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    const change = changes[SESSION_STATE_KEY] as { newValue?: SessionState } | undefined;
    if (change?.newValue) render(change.newValue);
  });

  void refreshTab();
  void refreshState();
}

void main();
