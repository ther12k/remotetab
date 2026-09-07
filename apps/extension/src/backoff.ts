/**
 * Reconnect backoff for the signaling client: capped exponential, reset on
 * every successful (re)connection.
 */
export class BackoffPolicy {
  private attempt = 0;

  constructor(
    private readonly baseMs: number,
    private readonly maxMs: number,
  ) {}

  /** Next delay, then advance. Resets only via reset(). */
  next(): number {
    const delay = Math.min(this.baseMs * 2 ** this.attempt, this.maxMs);
    this.attempt += 1;
    return delay;
  }

  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }
}
