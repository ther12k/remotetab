/**
 * E2E-03 / E2E-04 / E2E-07 / E2E-08 (TEST_STRATEGY.md) — skeleton spec.
 *
 * The spec drives the REAL extension against the neutral test page. It
 * requires a local Chrome + the unpacked extension (see playwright.config.ts
 * header). CI does not run this; it is the local evidence harness for
 * docs/MANUAL_EVIDENCE.md. Assertions use the page's __testState only.
 *
 * TODO(#020 follow-up): drive the popup via chrome.action; today the flow
 * assumes the user clicks Enable Remote once at session start.
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5599/test-page.html');
});

test('neutral page exposes its test state', async ({ page }) => {
  const state = await page.evaluate(() => typeof (window as { __testState?: unknown }).__testState);
  expect(state).toBe('object');
});

test('typing into the input records exact text', async ({ page }) => {
  await page.click('#text-input');
  await page.keyboard.type('hello world');
  const value = await page.inputValue('#text-input');
  expect(value).toBe('hello world');
});

test('Enter and Backspace are observable key events', async ({ page }) => {
  await page.click('#text-input');
  await page.keyboard.type('ab');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  const events = await page.evaluate(() =>
    (window as { __testState: { events: string[] } }).__testState.events.join('\n'),
  );
  expect(events).toContain('keydown key=Backspace');
  expect(events).toContain('keydown key=Enter');
});

test('scroll region reports scrollTop without clicks', async ({ page }) => {
  await page.hover('#scroll-region');
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  const scrollTop = await page.textContent('#scroll-value');
  expect(Number(scrollTop)).toBeGreaterThan(0);
});
