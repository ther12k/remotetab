import { describe, expect, it } from 'vitest';
import { toCdpModifiers, windowsVirtualKeyCode } from './input-adapter.ts';

describe('toCdpModifiers', () => {
  it('maps RemoteTab bits to CDP bits', () => {
    // RemoteTab: CTRL=1, ALT=2, SHIFT=4, META=8. CDP: alt=1, ctrl=2, meta=4, shift=8.
    expect(toCdpModifiers(0)).toBe(0);
    expect(toCdpModifiers(1)).toBe(2); // ctrl
    expect(toCdpModifiers(2)).toBe(1); // alt
    expect(toCdpModifiers(4)).toBe(8); // shift
    expect(toCdpModifiers(8)).toBe(4); // meta
    expect(toCdpModifiers(15)).toBe(15);
  });
});

describe('windowsVirtualKeyCode', () => {
  it('maps common control keys', () => {
    expect(windowsVirtualKeyCode('Enter')).toBe(13);
    expect(windowsVirtualKeyCode('Backspace')).toBe(8);
    expect(windowsVirtualKeyCode('Tab')).toBe(9);
    expect(windowsVirtualKeyCode('Escape')).toBe(27);
    expect(windowsVirtualKeyCode('ArrowLeft')).toBe(37);
    expect(windowsVirtualKeyCode('ArrowRight')).toBe(39);
    expect(windowsVirtualKeyCode('ArrowUp')).toBe(38);
    expect(windowsVirtualKeyCode('ArrowDown')).toBe(40);
    expect(windowsVirtualKeyCode('Delete')).toBe(46);
    expect(windowsVirtualKeyCode('Space')).toBe(32);
  });

  it('maps letters, digits and numpad from code patterns', () => {
    expect(windowsVirtualKeyCode('KeyA')).toBe(65);
    expect(windowsVirtualKeyCode('KeyZ')).toBe(90);
    expect(windowsVirtualKeyCode('Digit0')).toBe(48);
    expect(windowsVirtualKeyCode('Digit9')).toBe(57);
    expect(windowsVirtualKeyCode('Numpad5')).toBe(101);
  });

  it('returns undefined for unknown codes (documented best-effort)', () => {
    expect(windowsVirtualKeyCode('F13')).toBeUndefined();
    expect(windowsVirtualKeyCode('MadeUp')).toBeUndefined();
  });
});
