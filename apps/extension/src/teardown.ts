/**
 * Central teardown orchestrator (issue #012 — release-blocking lifecycle).
 *
 * Every stop/error path funnels through one idempotent `run()`. Steps execute
 * in order and ALWAYS attempt the remaining steps even when an earlier one
 * throws (failures are collected, never silently swallowed). Concurrent and
 * repeated calls await the same single pass.
 */

export type TeardownStep = {
  name: string;
  run: () => Promise<void>;
};

export type TeardownReport = {
  completed: string[];
  failed: { name: string; reason: string }[];
};

export class TeardownOrchestrator {
  private runningPass: Promise<TeardownReport> | null = null;
  private finished: TeardownReport | null = null;

  constructor(private readonly steps: TeardownStep[]) {}

  /** Idempotent: one pass total; later callers await the same result. */
  run(): Promise<TeardownReport> {
    if (this.finished !== null) return Promise.resolve(this.finished);
    if (this.runningPass !== null) return this.runningPass;
    this.runningPass = this.execute().then((report) => {
      this.finished = report;
      this.runningPass = null;
      return report;
    });
    return this.runningPass;
  }

  get isDone(): boolean {
    return this.finished !== null;
  }

  private async execute(): Promise<TeardownReport> {
    const report: TeardownReport = { completed: [], failed: [] };
    for (const step of this.steps) {
      try {
        await step.run();
        report.completed.push(step.name);
      } catch (err) {
        report.failed.push({
          name: step.name,
          reason:
            err instanceof Error ? `${err.name}: ${err.message.slice(0, 80)}` : 'unknown error',
        });
      }
    }
    return report;
  }
}
