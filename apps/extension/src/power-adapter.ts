/**
 * Keep-awake lifecycle (ADR-011): request "system" — keeps the laptop awake
 * while allowing the screen to turn off. Requested ONLY while Remote Mode is
 * active; central teardown always releases. Injectable for lifecycle tests.
 */

export interface PowerAdapter {
  requestSystem(): void;
  release(): void;
}

export class ChromePowerAdapter implements PowerAdapter {
  requestSystem(): void {
    // chrome.power keeps a request count; request/release are paired by the
    // teardown orchestrator.
    browser_power().requestSystem();
  }

  release(): void {
    browser_power().release();
  }
}

function browser_power(): { requestSystem(): void; release(): void } {
  // Accessed lazily so importing this module never touches chrome.* in tests.
  const power = (
    globalThis as {
      chrome?: { power?: { requestKeepAwake(level: string): void; releaseKeepAwake(): void } };
    }
  ).chrome?.power;
  if (!power) throw new Error('chrome.power unavailable');
  return {
    requestSystem: () => power.requestKeepAwake('system'),
    release: () => power.releaseKeepAwake(),
  };
}
