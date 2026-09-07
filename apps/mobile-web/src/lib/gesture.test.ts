import { describe, expect, it } from 'vitest';
import { GestureClassifier } from './gesture.ts';

const t = (x: number, y: number, tms: number) => ({ x, y, t: tms });

describe('GestureClassifier — pointer mode', () => {
  it('recognizes a quick small tap as a single click', () => {
    const g = new GestureClassifier('pointer');
    g.pointerDown(t(100, 100, 0));
    g.move(t(101, 101, 40));
    const up = g.up(t(101, 101, 120));
    expect(up).toEqual({ kind: 'tap', point: t(101, 101, 120), clickCount: 1 });
  });

  it('recognizes a double tap', () => {
    const g = new GestureClassifier('pointer');
    g.pointerDown(t(100, 100, 0));
    g.up(t(100, 100, 100));
    g.pointerDown(t(102, 102, 250));
    const up = g.up(t(102, 102, 380));
    expect(up && up.kind === 'tap' && up.clickCount).toBe(2);
  });

  it('two slow taps far apart stay single clicks', () => {
    const g = new GestureClassifier('pointer');
    g.pointerDown(t(100, 100, 0));
    g.up(t(100, 100, 100));
    g.pointerDown(t(200, 200, 1000));
    const up = g.up(t(200, 200, 1100));
    expect(up && up.kind === 'tap' && up.clickCount).toBe(1);
  });

  it('movement past the slop becomes a drag, never a click', () => {
    const g = new GestureClassifier('pointer');
    g.pointerDown(t(100, 100, 0));
    expect(g.move(t(140, 100, 60))?.kind).toBe('drag-start');
    expect(g.move(t(180, 100, 90))?.kind).toBe('drag-move');
    const up = g.up(t(200, 100, 120));
    expect(up?.kind).toBe('drag-end');
  });

  it('a long-press without movement is not a tap (too slow)', () => {
    const g = new GestureClassifier('pointer');
    g.pointerDown(t(100, 100, 0));
    expect(g.up(t(100, 100, 800))).toBeNull();
  });
});

describe('GestureClassifier — scroll mode', () => {
  it('converts movement to wheel deltas and never clicks', () => {
    const g = new GestureClassifier('scroll');
    g.pointerDown(t(100, 100, 0));
    const wheel = g.move(t(100, 160, 50));
    expect(wheel).toEqual({ kind: 'wheel', point: t(100, 160, 50), deltaX: 0, deltaY: 60 });
    // Even a tap-like release produces no click in scroll mode.
    expect(g.up(t(101, 161, 80))).toBeNull();
  });
});
