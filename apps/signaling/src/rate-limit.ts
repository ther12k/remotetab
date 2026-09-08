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

/**
 * Fixed-window rate limiter keyed by device id (#29): bounds TURN credential
 * issuance per device. Only registered device ids reach this limiter, so the
 * key space is bounded by enrollment.
 */
export class DeviceRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Record one request for `key` at `nowMs`; false when over the limit. */
  allow(key: string, nowMs: number): boolean {
    const window = this.windows.get(key);
    if (window === undefined || nowMs - window.start >= this.windowMs) {
      if (this.windows.size >= this.maxKeys) this.windows.clear();
      this.windows.set(key, { start: nowMs, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.maxPerWindow;
  }
}
