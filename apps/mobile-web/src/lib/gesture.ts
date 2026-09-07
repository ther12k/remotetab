/**
 * Gesture classifier for the viewer (pure, no DOM — tests drive it).
 *
 * Pointer mode (UX_FLOWS.md):
 *   - tap  (short, small movement)          → click (clickCount 1 or 2);
 *   - drag (movement past the threshold)    → pointer moves, no click;
 *
 * Scroll mode:
 *   - one-finger motion                     → wheel deltas, never a click.
 */

export type Mode = 'pointer' | 'scroll';

export type TouchPoint = { x: number; y: number; t: number };

export type GestureEvent =
  | { kind: 'tap'; point: TouchPoint; clickCount: 1 | 2 }
  | { kind: 'drag-start'; point: TouchPoint }
  | { kind: 'drag-move'; point: TouchPoint }
  | { kind: 'drag-end'; point: TouchPoint }
  | { kind: 'wheel'; point: TouchPoint; deltaX: number; deltaY: number }
  | null;

const TAP_MAX_MS = 300;
const TAP_MAX_SLOP_PX = 10;
const DOUBLE_TAP_MAX_MS = 300;
const DOUBLE_TAP_MAX_SLOP_PX = 40;
/** Movement per event beyond which a drag is recognized. */
const DRAG_SLOP_PX = 8;

export class GestureClassifier {
  private downPoint: TouchPoint | null = null;
  private last: TouchPoint | null = null;
  private dragged = false;
  private lastTap: TouchPoint | null = null;

  private mode: Mode;

  constructor(mode: Mode) {
    this.mode = mode;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.reset();
  }

  reset(): void {
    this.downPoint = null;
    this.last = null;
    this.dragged = false;
  }

  pointerDown(p: TouchPoint): GestureEvent {
    this.reset();
    this.downPoint = p;
    this.last = p;
    return null;
  }

  move(p: TouchPoint): GestureEvent {
    if (this.downPoint === null || this.last === null) return null;
    const total = distance(this.downPoint, p);
    if (this.mode === 'scroll') {
      // Every move becomes wheel motion relative to the previous sample.
      const dx = p.x - this.last.x;
      const dy = p.y - this.last.y;
      this.last = p;
      if (dx === 0 && dy === 0) return null;
      return { kind: 'wheel', point: p, deltaX: dx, deltaY: dy };
    }
    if (!this.dragged && total > DRAG_SLOP_PX) {
      this.dragged = true;
      return { kind: 'drag-start', point: p };
    }
    if (this.dragged) {
      this.last = p;
      return { kind: 'drag-move', point: p };
    }
    this.last = p;
    return null;
  }

  up(p: TouchPoint): GestureEvent {
    const down = this.downPoint;
    this.downPoint = null;
    if (down === null) return null;
    const duration = p.t - down.t;
    const moved = distance(down, p);

    if (this.mode === 'scroll') {
      this.last = null;
      return null; // a scroll gesture never clicks
    }
    if (this.dragged) {
      this.dragged = false;
      return { kind: 'drag-end', point: p };
    }
    if (duration <= TAP_MAX_MS && moved <= TAP_MAX_SLOP_PX) {
      let clickCount: 1 | 2 = 1;
      if (
        this.lastTap !== null &&
        p.t - this.lastTap.t <= DOUBLE_TAP_MAX_MS &&
        distance(this.lastTap, p) <= DOUBLE_TAP_MAX_SLOP_PX
      ) {
        clickCount = 2;
        this.lastTap = null;
      } else {
        this.lastTap = p;
      }
      return { kind: 'tap', point: p, clickCount };
    }
    return null;
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
