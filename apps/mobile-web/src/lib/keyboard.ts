/**
 * Keyboard mapping helpers (issue #011). Pure, DOM-free.
 *
 * The bridge sends CONTROL keys as remote key.down/key.up and free text via
 * bounded text.insert chunks. It is a transport for whatever the user is
 * typing into the currently focused remote element — never a message
 * history store, and typed text never reaches logs or diagnostics.
 */

import { MAX_TEXT_LENGTH, MODIFIER, type RemoteKey } from '@remotetab/protocol';

/** KeyboardEvent-like input so tests need no DOM. */
export type KeyInput = {
  key: string;
  code: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

/** Keys the bridge mirrors as key down/up pairs. */
const CONTROL_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Tab',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

export function modifiersOf(e: KeyInput): number {
  return (
    (e.ctrlKey ? MODIFIER.CTRL : 0) |
    (e.altKey ? MODIFIER.ALT : 0) |
    (e.shiftKey ? MODIFIER.SHIFT : 0) |
    (e.metaKey ? MODIFIER.META : 0)
  );
}

/** Map a keydown to a RemoteKey when it is a mirrored control key. */
export function mapControlKey(e: KeyInput): RemoteKey | null {
  if (!CONTROL_KEYS.has(e.key)) return null;
  return { key: e.key, code: e.code || e.key, modifiers: modifiersOf(e) };
}

/**
 * Split text into well-formed chunks that each respect the protocol's
 * MAX_TEXT_LENGTH and never split a surrogate pair.
 */
export function splitTextChunks(text: string, max = Math.min(MAX_TEXT_LENGTH, 500)): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    // Avoid splitting a surrogate pair across the boundary.
    if (end < text.length) {
      const c = text.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) {
        end -= 1;
      }
    }
    if (end <= start) break;
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

/** True when the keydown is plain character input better sent as text. */
export function isCharacterKey(e: KeyInput): boolean {
  if (e.ctrlKey || e.altKey || e.metaKey) return false;
  if (CONTROL_KEYS.has(e.key)) return false;
  // Count Unicode code points so emoji (surrogate pairs) count as one char.
  return [...e.key].length === 1;
}
