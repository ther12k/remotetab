import { describe, expect, it } from 'vitest';
import { isCapturableUrl, toTabDisplay } from './tabs.ts';

describe('tab display sanitization', () => {
  it('shows origin only, never query or fragment', () => {
    const display = toTabDisplay({
      id: 3,
      title: 'ChatGPT',
      url: 'https://chatgpt.com/c/abc?utm_source=x#frag',
    });
    expect(display?.origin).toBe('https://chatgpt.com');
    expect(display?.origin).not.toContain('utm');
    expect(display?.origin).not.toContain('frag');
  });

  it('truncates long titles', () => {
    const display = toTabDisplay({ id: 1, title: 'x'.repeat(200), url: 'https://a.example.com' });
    expect(display?.title.length).toBeLessThanOrEqual(80);
  });

  it('rejects tabs without usable ids', () => {
    expect(toTabDisplay({ id: -1, title: 't', url: 'https://a.example.com' })).toBeNull();
    expect(toTabDisplay({ title: 't', url: 'https://a.example.com' })).toBeNull();
  });
});

describe('capturable URLs', () => {
  it('accepts http(s) and file', () => {
    expect(isCapturableUrl('https://chatgpt.com')).toBe(true);
    expect(isCapturableUrl('http://localhost:5500/test-page.html')).toBe(true);
    expect(isCapturableUrl('file:///tmp/page.html')).toBe(true);
  });

  it('rejects browser pages and empty urls', () => {
    expect(isCapturableUrl('chrome://settings')).toBe(false);
    expect(isCapturableUrl('chrome-extension://abc/popup.html')).toBe(false);
    expect(isCapturableUrl('about:blank')).toBe(false);
    expect(isCapturableUrl(undefined)).toBe(false);
  });
});
