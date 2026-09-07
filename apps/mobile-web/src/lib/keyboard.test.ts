import { MAX_TEXT_LENGTH, MODIFIER } from '@remotetab/protocol';
import { describe, expect, it } from 'vitest';
import { isCharacterKey, mapControlKey, modifiersOf, splitTextChunks } from './keyboard.ts';

describe('mapControlKey', () => {
  it('mirrors the documented control keys', () => {
    for (const key of [
      'Enter',
      'Backspace',
      'Delete',
      'Tab',
      'Escape',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]) {
      expect(mapControlKey({ key, code: key })).not.toBeNull();
    }
  });

  it('carries modifier bits', () => {
    const mapped = mapControlKey({ key: 'Tab', code: 'Tab', shiftKey: true });
    expect(mapped?.modifiers).toBe(MODIFIER.SHIFT);
    const combo = mapControlKey({ key: 'Enter', code: 'Enter', ctrlKey: true, altKey: true });
    expect(combo?.modifiers).toBe(MODIFIER.CTRL | MODIFIER.ALT);
  });

  it('ignores printable characters (they travel as text)', () => {
    expect(mapControlKey({ key: 'a', code: 'KeyA' })).toBeNull();
    expect(mapControlKey({ key: ' ', code: 'Space' })).toBeNull();
  });
});

describe('modifiersOf', () => {
  it('combines modifier bits', () => {
    expect(modifiersOf({ key: 'x', code: 'KeyX', shiftKey: true, metaKey: true })).toBe(
      MODIFIER.SHIFT | MODIFIER.META,
    );
    expect(modifiersOf({ key: 'x', code: 'KeyX' })).toBe(MODIFIER.NONE);
  });
});

describe('isCharacterKey', () => {
  it('sends printable keys as text, except with modifiers', () => {
    expect(isCharacterKey({ key: 'a', code: 'KeyA' })).toBe(true);
    expect(isCharacterKey({ key: '👍', code: 'Emoji' })).toBe(true);
    expect(isCharacterKey({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false);
    expect(isCharacterKey({ key: 'Enter', code: 'Enter' })).toBe(false);
  });
});

describe('splitTextChunks', () => {
  it('respects the chunk limit', () => {
    const chunks = splitTextChunks('a'.repeat(1200), 500);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 200]);
  });

  it('never splits surrogate pairs', () => {
    const text = `${'x'.repeat(499)}👍${'y'.repeat(10)}`;
    const chunks = splitTextChunks(text, 500);
    for (const chunk of chunks) {
      // Every chunk must be well-formed UTF-16.
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = chunk.charCodeAt(i + 1);
          expect(next).toBeGreaterThanOrEqual(0xdc00);
          expect(next).toBeLessThanOrEqual(0xdfff);
          i++;
        }
      }
    }
    expect(chunks.join('')).toBe(text);
  });

  it('defaults to at most MAX_TEXT_LENGTH so every chunk fits one frame', () => {
    const chunks = splitTextChunks('a'.repeat(MAX_TEXT_LENGTH + 1));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    }
  });

  it('handles empty text', () => {
    expect(splitTextChunks('')).toEqual([]);
  });
});
