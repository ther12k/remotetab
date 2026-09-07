import { describe, expect, it } from 'vitest';
import { contentRect, denormalize, normalizePoint } from './video-rect.ts';

describe('contentRect (object-fit: contain)', () => {
  it('returns the full box when ratios match', () => {
    const rect = contentRect({
      element: { width: 800, height: 600 },
      video: { width: 1440, height: 1080 },
    });
    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });

  it('letterboxes horizontally when the element is taller (portrait phone)', () => {
    const rect = contentRect({
      element: { width: 390, height: 700 },
      video: { width: 1920, height: 1080 },
    });
    expect(rect).toEqual({
      x: 0,
      y: (700 - 390 / (1920 / 1080)) / 2,
      width: 390,
      height: 390 / (1920 / 1080),
    });
  });

  it('letterboxes vertically when the element is wider (landscape phone)', () => {
    const rect = contentRect({
      element: { width: 800, height: 400 },
      video: { width: 1024, height: 768 },
    });
    expect(rect).toEqual({
      x: (800 - 400 * (1024 / 768)) / 2,
      y: 0,
      width: 400 * (1024 / 768),
      height: 400,
    });
  });

  it('returns null for degenerate sizes', () => {
    expect(
      contentRect({ element: { width: 0, height: 400 }, video: { width: 10, height: 10 } }),
    ).toBeNull();
    expect(
      contentRect({ element: { width: 800, height: 600 }, video: { width: 0, height: 0 } }),
    ).toBeNull();
  });
});

describe('normalizePoint', () => {
  const geometry = {
    element: { width: 390, height: 700 },
    video: { width: 1920, height: 1080 },
  };
  const rect = contentRect(geometry);

  it('maps content corners to 0..1', () => {
    expect(rect).not.toBeNull();
    if (!rect) return;
    const topLeft = normalizePoint({ x: rect.x, y: rect.y }, geometry);
    const bottomRight = normalizePoint(
      { x: rect.x + rect.width, y: rect.y + rect.height },
      geometry,
    );
    expect(topLeft).toEqual({ x: 0, y: 0 });
    expect(bottomRight).toEqual({ x: 1, y: 1 });
  });

  it('rejects letterbox taps', () => {
    expect(rect).not.toBeNull();
    if (!rect) return;
    // Above the content (top letterbox bar).
    expect(normalizePoint({ x: rect.x + 10, y: rect.y - 5 }, geometry)).toBeNull();
    // Far right of a horizontally-bounded content area.
    expect(normalizePoint({ x: rect.x + rect.width + 50, y: rect.y + 10 }, geometry)).toBeNull();
  });

  it('clamps epsilon edge taps back into range', () => {
    expect(rect).not.toBeNull();
    if (!rect) return;
    const edge = normalizePoint({ x: rect.x + rect.width + 0.05, y: rect.y }, geometry);
    expect(edge?.x).toBe(1);
  });
});

describe('denormalize', () => {
  it('maps normalized coordinates to target CSS pixels', () => {
    expect(denormalize({ x: 0.5, y: 0.5 }, { width: 1440, height: 900 })).toEqual({
      x: 720,
      y: 450,
    });
    expect(denormalize({ x: 0, y: 1 }, { width: 1440, height: 900 })).toEqual({ x: 0, y: 900 });
  });
});
