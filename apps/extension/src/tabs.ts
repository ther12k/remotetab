/**
 * Active-tab helpers: query the current tab and produce a sanitized display
 * (origin only — never the full URL, whose query/fragment could carry
 * sensitive data).
 */

export type TabDisplay = {
  tabId: number;
  title: string;
  origin: string;
};

function sanitizeOrigin(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
}

export function toTabDisplay(tab: {
  id?: number;
  title?: string;
  url?: string;
}): TabDisplay | null {
  if (typeof tab.id !== 'number' || tab.id < 0) return null;
  return {
    tabId: tab.id,
    title: (tab.title ?? 'Untitled tab').slice(0, 80),
    origin: sanitizeOrigin(tab.url) || 'local file',
  };
}

/** Pages tabCapture cannot attach to; we fail early with a clear message. */
export function isCapturableUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  return (
    rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('file://')
  );
}
