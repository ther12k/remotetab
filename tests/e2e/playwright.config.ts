import { defineConfig } from 'playwright/test';

/**
 * RemoteTab browser E2E (issue #020).
 *
 * Runs against REAL Chrome (needed for chrome.tabCapture + chrome.debugger):
 *   bunx playwright install chrome
 *   bun run build:extension && bun run dev:signaling   # in another shell
 *   bunx playwright test -c tests/e2e/playwright.config.ts
 *
 * The neutral test page (fixtures/test-page.html) is served locally; the
 * extension is loaded unpacked from apps/extension/.output/chrome-mv3.
 * Assertions read the page's own __testState — never ChatGPT DOM.
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  use: {
    headless: false, // extensions require headed Chrome
    channel: 'chrome',
    launchOptions: {
      args: [
        `--disable-extensions-except=/home/runner/remotetab/apps/extension/.output/chrome-mv3`,
        `--load-extension=/home/runner/remotetab/apps/extension/.output/chrome-mv3`,
      ],
    },
  },
  webServer: {
    command: 'python3 -m http.server 5599 --directory fixtures',
    port: 5599,
    reuseExistingServer: true,
  },
});
