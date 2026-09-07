/**
 * Minimal per-connection sliding-window rate limiter for signaling frames.
 * #018 expands this with per-IP limits and pairing brute-force throttling.
 */
export class FrameRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxFrames: number,
    private readonly windowMs: number,
  ) {}

  /** Record one frame at `nowMs`; false when over the limit. */
  allow(nowMs: number): boolean {
    for (;;) {
      const oldest = this.timestamps[0];
      if (oldest === undefined || nowMs - oldest <= this.windowMs) break;
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maxFrames) return false;
    this.timestamps.push(nowMs);
    return true;
  }
}
