/**
 * Popup UI (vanilla TS, no framework — keeps the privileged context lean).
 * Renders the current tab + session state and drives Enable/Stop via the
 * service worker. All Enable actions are explicit local user clicks.
 */

import qrcode from 'qrcode-generator';
import { browser } from 'wxt/browser';
import {
  type PairStartResponse,
  type PopupRequest,
  SESSION_STATE_KEY,
  type SettingsResponse,
  type StateResponse,
} from '@/messages.ts';
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
  const captureEl = document.getElementById('capture');
  if (!phaseEl || !enableBtn || !stopBtn || !errorEl) return;

  const active = state.phase !== 'idle';
  phaseEl.textContent = PHASE_LABEL[state.phase];
  phaseEl.classList.toggle('active', active);
  enableBtn.hidden = active;
  stopBtn.hidden = !active;
  errorEl.textContent = state.error?.message ?? '';
  if (captureEl) {
    captureEl.hidden = !active;
    captureEl.textContent = state.phase === 'idle' ? '' : `Capture: ${state.capture}`;
  }
}

async function refreshSettings(): Promise<void> {
  const res = (await browser.runtime.sendMessage({ type: 'getSettings' })) as SettingsResponse;
  const codeEl = document.getElementById('device-code');
  const urlEl = document.getElementById('signaling-url') as HTMLInputElement | null;
  if (res.ok) {
    if (codeEl) codeEl.textContent = res.deviceId;
    if (urlEl && document.activeElement !== urlEl) urlEl.value = res.settings.signalingUrl;
  } else if (codeEl) {
    codeEl.textContent = 'unavailable';
  }
}

async function onSaveSettings(): Promise<void> {
  const urlEl = document.getElementById('signaling-url') as HTMLInputElement | null;
  const msgEl = document.getElementById('settings-msg');
  if (!urlEl || !msgEl) return;
  const res = (await browser.runtime.sendMessage({
    type: 'saveSettings',
    signalingUrl: urlEl.value.trim(),
    iceUrls: ['stun:stun.l.google.com:19302'],
  })) as SettingsResponse;
  msgEl.textContent = res.ok
    ? 'Saved. Applies on next Enable.'
    : (res.error.message ?? 'Save failed.');
}

/**
 * E2E test hook: popup.html?tabId=N pins the capture target. A real popup
 * always resolves the active tab; only the test harness opens popup.html as
 * a normal tab, where "active tab" would be the popup itself.
 */
function pinnedTestTabId(): number | null {
  try {
    const raw = new URLSearchParams(location.search).get('tabId');
    const n = raw === null ? NaN : Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

async function resolveTargetTab(): Promise<{ id?: number; title?: string; url?: string } | null> {
  const pinned = pinnedTestTabId();
  if (pinned !== null) {
    return (await browser.tabs.get(pinned).catch(() => null)) ?? null;
  }
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function refreshTab(): Promise<void> {
  const tab = await resolveTargetTab();
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
  const tab = await resolveTargetTab();
  const errorEl = document.getElementById('error');
  if (!tab?.id) {
    if (errorEl) errorEl.textContent = 'No active tab found.';
    return;
  }
  // The streamId MUST be requested inside this click handler: tabCapture
  // requires a local user gesture (ADR-013). The offscreen document consumes
  // the id; it can never be obtained in the background without a gesture.
  let streamId: string;
  try {
    streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch {
    if (errorEl) {
      errorEl.textContent =
        'Chrome refused to capture this tab. Click Enable Remote again on the tab you want to share.';
    }
    return;
  }
  const res = await sendPopupRequest({ type: 'enableRemote', tabId: tab.id, streamId });
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
  (document.getElementById('save-settings') as HTMLButtonElement | null)?.addEventListener(
    'click',
    () => void onSaveSettings(),
  );
  (document.getElementById('pair-start') as HTMLButtonElement | null)?.addEventListener(
    'click',
    () => void onPairStart(),
  );
  (document.getElementById('pair-cancel') as HTMLButtonElement | null)?.addEventListener(
    'click',
    () => void onPairCancel(),
  );

  // Live state updates from the service worker.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    const change = changes[SESSION_STATE_KEY] as { newValue?: SessionState } | undefined;
    if (change?.newValue) render(change.newValue);
  });

  void refreshTab();
  void refreshState();
  void refreshSettings();
  void refreshPaired();
}

async function refreshPaired(): Promise<void> {
  const el = document.getElementById('paired-list');
  if (!el) return;
  const res = (await browser.runtime.sendMessage({ type: 'pairedList' })) as {
    ok: boolean;
    devices?: { deviceId: string; displayName: string }[];
  };
  if (res.ok && res.devices && res.devices.length > 0) {
    el.textContent = res.devices.map((d) => d.displayName).join(', ');
  } else {
    el.textContent = 'No phones paired yet.';
  }
}

let countdownTimer: ReturnType<typeof setInterval> | null = null;

async function onPairStart(): Promise<void> {
  const qrWrap = document.getElementById('pair-qr-wrap');
  const qrImg = document.getElementById('pair-qr') as HTMLImageElement | null;
  const codeEl = document.getElementById('pair-code');
  const startBtn = document.getElementById('pair-start') as HTMLButtonElement | null;
  const errorEl = document.getElementById('error');
  const res = (await browser.runtime.sendMessage({ type: 'pairStart' })) as PairStartResponse;
  if (!res.ok) {
    if (errorEl) errorEl.textContent = res.error.message;
    return;
  }
  if (!qrWrap || !qrImg || !codeEl || !startBtn) return;
  const qr = qrcode(0, 'M');
  qr.addData(res.payload);
  qr.make();
  qrImg.src = qr.createDataURL(4, 4);
  codeEl.textContent = res.payload;
  qrWrap.hidden = false;
  startBtn.disabled = true;
  const countdown = document.getElementById('pair-countdown');
  if (countdown) {
    if (countdownTimer !== null) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const left = Math.max(0, Math.round((res.expiresAtMs - Date.now()) / 1000));
      countdown.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      if (left <= 0) {
        clearInterval(countdownTimer ?? undefined);
        void refreshPairingIdle();
      }
    }, 500);
  }
  void refreshPaired();
}

function refreshPairingIdle(): void {
  const qrWrap = document.getElementById('pair-qr-wrap');
  const startBtn = document.getElementById('pair-start') as HTMLButtonElement | null;
  if (qrWrap) qrWrap.hidden = true;
  if (startBtn) startBtn.disabled = false;
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

async function onPairCancel(): Promise<void> {
  await browser.runtime.sendMessage({ type: 'pairCancel' });
  refreshPairingIdle();
}

void main();
