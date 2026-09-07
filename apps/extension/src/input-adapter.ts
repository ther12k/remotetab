/**
 * Remote input adapter contract (MVP_IMPLEMENTATION_BLUEPRINT §4). The phone
 * sends product-level messages; ONLY these narrowly typed operations exist.
 * There is no sendCommand(method, params) escape hatch reachable from peer
 * input (ADR-004) — negative tests enforce this.
 */

import type { ControlPayload } from '@remotetab/protocol';

export type Viewport = { width: number; height: number; deviceScaleFactor: number };

/** Normalized [0..1] target coordinates. */
export type NormalizedPointer = ControlPayload<'pointer.move'>;
export type NormalizedPointerButton = ControlPayload<'pointer.down'>;
export type NormalizedWheel = ControlPayload<'wheel'>;
export type RemoteKey = ControlPayload<'key.down'>;

export interface RemoteInputAdapter {
  attach(tabId: number): Promise<void>;
  detach(): Promise<void>;
  get isAttached(): boolean;
  getViewport(): Promise<Viewport>;
  pointerMove(input: NormalizedPointer): Promise<void>;
  pointerDown(input: NormalizedPointerButton): Promise<void>;
  pointerUp(input: NormalizedPointerButton): Promise<void>;
  wheel(input: NormalizedWheel): Promise<void>;
  keyDown(input: RemoteKey): Promise<void>;
  keyUp(input: RemoteKey): Promise<void>;
  insertText(text: string): Promise<void>;
}

/**
 * Map RemoteTab MODIFIER bits (limits.ts) to CDP Input modifiers:
 * alt=1, ctrl=2, meta=4, shift=8.
 */
export function toCdpModifiers(modifiers: number): number {
  const bit = (flag: number) => (modifiers & flag) !== 0;
  return (bit(1) ? 2 : 0) | (bit(2) ? 1 : 0) | (bit(4) ? 8 : 0) | (bit(8) ? 4 : 0);
}

/**
 * Windows virtual key codes for the key codes the PWA bridge sends
 * (MDN KeyboardEvent.code values). Unmapped codes dispatch without a VK code
 * and are documented as best-effort rather than corrupted.
 */
const KEY_CODES: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  ShiftLeft: 16,
  ShiftRight: 16,
  ControlLeft: 17,
  ControlRight: 17,
  AltLeft: 18,
  AltRight: 18,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  MetaLeft: 91,
  MetaRight: 91,
  Semicolon: 186,
  Equal: 187,
  Comma: 188,
  Minus: 189,
  Period: 190,
  Slash: 191,
  Backquote: 192,
  BracketLeft: 219,
  Backslash: 220,
  BracketRight: 221,
  Quote: 222,
};

export function windowsVirtualKeyCode(code: string): number | undefined {
  if (KEY_CODES[code] !== undefined) return KEY_CODES[code];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) {
    const letterChar = letter[1];
    if (letterChar) return letterChar.charCodeAt(0);
  }
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) {
    const digitChar = digit[1];
    if (digitChar) return digitChar.charCodeAt(0);
  }
  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) {
    const numpadChar = numpad[1];
    if (numpadChar) return 96 + Number(numpadChar);
  }
  return undefined;
}
