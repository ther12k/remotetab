/**
 * Prioritized input sender (CONTROL_PROTOCOL.md backpressure):
 *   1. auth/session  (handled elsewhere, always immediate)
 *   2. key/button    (never silently dropped — retried while congested)
 *   3. text          (never dropped, bounded size upstream)
 *   4. wheel         (coalesced: deltas accumulate between flushes)
 *   5. pointer move  (coalesced: only the latest position is kept)
 *
 * The underlying transport is the reliable ordered control channel; drops
 * only ever affect stale moves/wheel, never state-changing input. Encoders
 * are supplied by the caller so this class stays protocol-agnostic.
 */

export type SenderTimers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

const defaultTimers: SenderTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class PrioritizedInputSender {
  private latestMove: string | null = null;
  private moveTimer: unknown = null;
  private pendingWheel: { x: number; y: number; deltaX: number; deltaY: number } | null = null;
  private wheelTimer: unknown = null;
  private urgentQueue: string[] = [];
  private retryTimer: unknown = null;
  private droppedMoves = 0;
  private sentFrames = 0;

  constructor(
    private readonly opts: {
      /** Raw transport; false means congested/closed. */
      send: (raw: string) => boolean;
      /** Encode a wheel frame from accumulated deltas at flush time. */
      encodeWheel: (deltas: { x: number; y: number; deltaX: number; deltaY: number }) => string;
      moveIntervalMs?: number;
      wheelIntervalMs?: number;
      retryMs?: number;
      timers?: SenderTimers;
    },
  ) {}

  get stats(): { sent: number; droppedMoves: number; queuedUrgent: number } {
    return {
      sent: this.sentFrames,
      droppedMoves: this.droppedMoves,
      queuedUrgent: this.urgentQueue.length,
    };
  }

  /** Pointer move: keep only the latest; flush at the move interval. */
  sendMove(raw: string): void {
    this.latestMove = raw;
    if (this.moveTimer !== null) return;
    const timers = this.opts.timers ?? defaultTimers;
    this.moveTimer = timers.set(() => {
      this.moveTimer = null;
      this.flushMove();
    }, this.opts.moveIntervalMs ?? 33);
  }

  private flushMove(): boolean {
    const raw = this.latestMove;
    this.latestMove = null;
    if (raw === null) return false;
    if (this.opts.send(raw)) {
      this.sentFrames += 1;
      return true;
    }
    this.droppedMoves += 1; // stale position: drop, the next move supersedes it
    return false;
  }

  /** Wheel: accumulate deltas; the encoder runs once per flush. */
  sendWheel(delta: { x: number; y: number; deltaX: number; deltaY: number }): void {
    if (this.pendingWheel === null) {
      this.pendingWheel = { ...delta };
    } else {
      this.pendingWheel = {
        x: delta.x,
        y: delta.y,
        deltaX: this.pendingWheel.deltaX + delta.deltaX,
        deltaY: this.pendingWheel.deltaY + delta.deltaY,
      };
    }
    if (this.wheelTimer !== null) return;
    const timers = this.opts.timers ?? defaultTimers;
    this.wheelTimer = timers.set(() => {
      this.wheelTimer = null;
      this.flushWheel();
    }, this.opts.wheelIntervalMs ?? 50);
  }

  private flushWheel(): boolean {
    const pending = this.pendingWheel;
    this.pendingWheel = null;
    if (pending === null) return false;
    if (this.opts.send(this.opts.encodeWheel(pending))) {
      this.sentFrames += 1;
      return true;
    }
    // Congested: keep accumulated deltas for the next flush.
    this.pendingWheel = pending;
    return false;
  }

  /** Key/button/text: enqueue and never drop; retried while congested. */
  sendUrgent(raw: string): boolean {
    this.urgentQueue.push(raw);
    this.flushUrgent();
    return this.urgentQueue.length === 0;
  }

  private flushUrgent(): void {
    while (this.urgentQueue.length > 0) {
      const raw = this.urgentQueue[0];
      if (raw === undefined) break;
      if (!this.opts.send(raw)) break; // congested/closed: stop, keep order
      this.urgentQueue.shift();
      this.sentFrames += 1;
    }
    if (this.urgentQueue.length > 0 && this.retryTimer === null) {
      const timers = this.opts.timers ?? defaultTimers;
      this.retryTimer = timers.set(() => {
        this.retryTimer = null;
        this.flushUrgent();
      }, this.opts.retryMs ?? 15);
    }
  }

  /** Flush a pending move immediately (e.g. right before a click lands). */
  flushNow(): void {
    this.flushMove();
  }

  /** Clear timers on teardown; queued urgent frames remain for inspection. */
  dispose(): void {
    const timers = this.opts.timers ?? defaultTimers;
    if (this.moveTimer !== null) {
      timers.clear(this.moveTimer);
      this.moveTimer = null;
    }
    if (this.wheelTimer !== null) {
      timers.clear(this.wheelTimer);
      this.wheelTimer = null;
    }
    if (this.retryTimer !== null) {
      timers.clear(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
