/**
 * Chrome debugger/CDP input adapter (ADR-004). Runs in the service worker —
 * the only place chrome.debugger is available.
 *
 * Security shape:
 *  - the CDP `sendCommand` call is PRIVATE and every call site passes a
 *    hardcoded method name plus typed params built from validated protocol
 *    payloads;
 *  - the phone can never choose a method name, and no generic bridge exists
 *    (release blocker, verified by scan + negative tests);
 *  - detach is idempotent and centralized teardown always calls it.
 */

import { MAX_TEXT_LENGTH } from '@remotetab/protocol';
import { browser } from 'wxt/browser';
import {
  type NormalizedPointer,
  type NormalizedPointerButton,
  type NormalizedWheel,
  type RemoteInputAdapter,
  type RemoteKey,
  toCdpModifiers,
  type Viewport,
  windowsVirtualKeyCode,
} from '@/input-adapter.ts';

const CDP_VER = '1.3';

/** Debugger attach failures mapped to user-readable copy. */
export function mapDebuggerError(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (/Another debugger|already attached|DevTools/i.test(raw)) {
    return 'Remote input could not attach to this tab. Chrome DevTools or another debugger may already be using it.';
  }
  if (/No tab with given identity|tab .* closed/i.test(raw)) {
    return 'The remote tab was closed.';
  }
  if (/Cannot attach to this target|not supported/i.test(raw)) {
    return 'Remote input cannot attach to this kind of page.';
  }
  return 'Remote input could not attach to this tab.';
}

export class CdpInputAdapter implements RemoteInputAdapter {
  private tabId: number | null = null;
  private attachedFlag = false;
  /** Serialize debugger commands: CDP errors interleave when re-ordered. */
  private queue: Promise<unknown> = Promise.resolve();

  get isAttached(): boolean {
    return this.attachedFlag;
  }

  get attachedTabId(): number | null {
    return this.tabId;
  }

  async attach(tabId: number): Promise<void> {
    if (this.attachedFlag && this.tabId === tabId) return;
    await this.detach();
    try {
      await browser.debugger.attach({ tabId }, CDP_VER);
      this.tabId = tabId;
      this.attachedFlag = true;
    } catch (err) {
      this.tabId = null;
      this.attachedFlag = false;
      throw new Error(mapDebuggerError(err), { cause: err });
    }
  }

  async detach(): Promise<void> {
    const tabId = this.tabId;
    this.tabId = null;
    this.attachedFlag = false;
    if (tabId === null) return;
    try {
      await browser.debugger.detach({ tabId });
    } catch {
      // Already detached (e.g. onDetach fired first) — detach stays idempotent.
    }
  }

  async getViewport(): Promise<Viewport> {
    const result = await this.send<{
      css?: {
        visualViewport?: { clientWidth?: number; clientHeight?: number };
        layoutViewport?: { clientWidth?: number; clientHeight?: number; pageScaleFactor?: number };
      };
    }>('Page.getLayoutMetrics', {});
    const css = result.css ?? {};
    const visual = css.visualViewport;
    const layout = css.layoutViewport;
    const width = visual?.clientWidth ?? layout?.clientWidth ?? 0;
    const height = visual?.clientHeight ?? layout?.clientHeight ?? 0;
    const scale = layout?.pageScaleFactor ?? 1;
    if (width <= 0 || height <= 0) {
      throw new Error('viewport metrics were unavailable');
    }
    return { width, height, deviceScaleFactor: scale };
  }

  async pointerMove(input: NormalizedPointer): Promise<void> {
    const { width, height } = await this.getViewport();
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: clamp(input.x * width, width),
      y: clamp(input.y * height, height),
      button: 'none',
      buttons: 0,
    });
  }

  async pointerDown(input: NormalizedPointerButton): Promise<void> {
    const { width, height } = await this.getViewport();
    const button = input.button;
    const x = clamp(input.x * width, width);
    const y = clamp(input.y * height, height);
    // Alpha debug instrumentation: verbose-level only (invisible unless the
    // SW console is set to Verbose). Coordinates and viewport dims only —
    // never page content. Compare against the phone's "tap x,y" overlay.
    console.debug(
      `[remotetab] pointer.down remote coordinate x=${Math.round(x)} y=${Math.round(y)} (viewport ${width}×${height}, from ${input.x.toFixed(3)},${input.y.toFixed(3)})`,
    );
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      buttons: buttonBit(button),
      clickCount: input.clickCount,
    });
  }

  async pointerUp(input: NormalizedPointerButton): Promise<void> {
    const { width, height } = await this.getViewport();
    const button = input.button;
    const x = clamp(input.x * width, width);
    const y = clamp(input.y * height, height);
    console.debug(
      `[remotetab] pointer.up remote coordinate x=${Math.round(x)} y=${Math.round(y)} (viewport ${width}×${height})`,
    );
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      buttons: 0,
      clickCount: input.clickCount,
    });
  }

  async wheel(input: NormalizedWheel): Promise<void> {
    const { width, height } = await this.getViewport();
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: clamp(input.x * width, width),
      y: clamp(input.y * height, height),
      deltaX: input.deltaX,
      deltaY: input.deltaY,
    });
  }

  async keyDown(input: RemoteKey): Promise<void> {
    const vk = windowsVirtualKeyCode(input.code);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: input.key,
      code: input.code,
      modifiers: toCdpModifiers(input.modifiers),
      ...(vk !== undefined ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
    });
  }

  async keyUp(input: RemoteKey): Promise<void> {
    const vk = windowsVirtualKeyCode(input.code);
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: input.key,
      code: input.code,
      modifiers: toCdpModifiers(input.modifiers),
      ...(vk !== undefined ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}),
    });
  }

  async insertText(text: string): Promise<void> {
    if (text.length > MAX_TEXT_LENGTH) {
      throw new Error('text exceeds the protocol length bound');
    }
    await this.send('Input.insertText', { text });
  }

  /**
   * The ONLY CDP entrypoint in RemoteTab. Private, and every call site in
   * this class passes a literal method name from this fixed set:
   * Page.getLayoutMetrics, Input.dispatchMouseEvent, Input.dispatchKeyEvent,
   * Input.insertText. Nothing else is reachable.
   */
  private send<T>(
    method:
      | 'Page.getLayoutMetrics'
      | 'Input.dispatchMouseEvent'
      | 'Input.dispatchKeyEvent'
      | 'Input.insertText',
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!this.attachedFlag || this.tabId === null) {
      return Promise.reject(new Error('INPUT_NOT_ATTACHED: debugger is not attached'));
    }
    const tabId = this.tabId;
    // Chain onto the queue so commands never interleave.
    const run = this.queue.then(async () => {
      try {
        return (await browser.debugger.sendCommand({ tabId }, method, params)) as T;
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'command failed';
        throw new Error(`${detail} (${method})`);
      }
    });
    // Errors are surfaced to the caller but must not poison the queue.
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function clamp(css: number, max: number): number {
  return Math.min(Math.max(css, 0), Math.max(max - 0.01, 0));
}

function buttonBit(button: 'left' | 'right' | 'middle'): number {
  switch (button) {
    case 'left':
      return 1;
    case 'right':
      return 2;
    case 'middle':
      return 4;
  }
}
