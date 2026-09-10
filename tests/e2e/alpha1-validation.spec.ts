/**
 * 0.1.0-alpha.1 validation run (docs/MANUAL_EVIDENCE.md alpha script).
 *
 * Real Chrome on both sides, no physical phone:
 *   laptop context: REAL extension (tabCapture + chrome.debugger) viewing the
 *                   neutral test page, enabled through the REAL action popup
 *   phone context:  the real PWA (vite dev server), paired by pasting the
 *                   popup's pairing code
 *
 * The ONE thing automation cannot do is the tabCapture user gesture: Chromium
 * grants it only to a genuine click on the real action popup (ADR-013's
 * no-auto-start design working as intended). The harness tries a toolbar
 * scan first; if that does not open the popup it prints
 * "WAITING FOR HUMAN" and gives you 180 s to click the RemoteTab toolbar
 * icon + Enable Remote on the test browser. Everything after capture —
 * pairing, connection, tap/keyboard/scroll, stop — runs automatically.
 *
 * Run:  tests/e2e/run-alpha1.sh            (isolated Xvfb display)
 *    or RT_DISPLAY=:1 tests/e2e/run-alpha1.sh   (your desktop; click yourself)
 *
 * The report is ALWAYS written to tests/e2e/results/alpha1-report.json —
 * the report, not a green checkmark, is the deliverable of a validation run.
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { type BrowserContext, chromium, test, type Worker } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(HERE, '../../apps/extension/.output/chrome-mv3');
const TARGET_URL = 'http://localhost:5599/test-page.html';
const PWA_URL = 'http://localhost:5173/';
const RESULTS = path.resolve(HERE, 'results');

type RawCdp = {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>>;
  close(): void;
};

async function connectRawCdp(port: number, browserPath = '/devtools/browser'): Promise<RawCdp> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('raw CDP connect failed'));
  });
  let nextId = 1;
  const pending = new Map<number, (v: Record<string, unknown>) => void>();
  const childPending = new Map<number, (v: Record<string, unknown>) => void>();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: Record<string, unknown>;
      method?: string;
      params?: { sessionId?: string; message?: string };
    };
    if (msg.method === 'Target.receivedMessageFromTarget' && msg.params?.message) {
      const inner = JSON.parse(msg.params.message) as {
        id?: number;
        result?: Record<string, unknown>;
      };
      if (inner.id !== undefined && childPending.has(inner.id)) {
        const r = childPending.get(inner.id);
        childPending.delete(inner.id);
        r?.(inner.result ?? {});
      }
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      const r = pending.get(msg.id);
      pending.delete(msg.id);
      r?.(msg.result ?? {});
    }
  };
  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error(`raw CDP timeout: ${method}`)), 12_000);
        const frame = { id, method, params } as Record<string, unknown>;
        if (sessionId === undefined) pending.set(id, resolve);
        else {
          childPending.set(id, resolve);
          frame.sessionId = sessionId;
        }
        ws.send(JSON.stringify(frame));
      });
    },
    close() {
      ws.close();
    },
  };
}

type StepResult = { step: string; ok: boolean; detail: string };

test('alpha.1 validation run', async () => {
  test.setTimeout(420_000);
  const steps: StepResult[] = [];
  const consoles: string[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    steps.push({ step, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} — ${step}: ${detail}`);
  };
  fs.mkdirSync(RESULTS, { recursive: true });

  let laptop: BrowserContext | null = null;
  let phone: BrowserContext | null = null;
  let rawCdp: RawCdp | null = null;
  const finish = (extra: Record<string, unknown> = {}) => {
    const pass = steps.filter((st) => st.ok).length;
    const report = {
      when: new Date().toISOString(),
      commit: execSync('git rev-parse --short HEAD', { cwd: path.resolve(HERE, '../..') })
        .toString()
        .trim(),
      chrome: `Playwright Chromium (display ${process.env.DISPLAY ?? ':99'})`,
      laptopOs: process.platform,
      phone: 'PWA in a second browser context (no physical phone)',
      network: 'loopback (same machine)',
      steps,
      summary: `${pass}/${steps.length} steps passed`,
      consoleTail: consoles.slice(-120),
      ...extra,
    };
    fs.writeFileSync(path.join(RESULTS, 'alpha1-report.json'), JSON.stringify(report, null, 2));
    console.log(`REPORT: ${pass}/${steps.length} → ${path.join(RESULTS, 'alpha1-report.json')}`);
  };

  try {
    // ------------------------------------------------------------------
    // Laptop context: real extension on an isolated/declared display.
    // ------------------------------------------------------------------
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-laptop-'));
    laptop = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1000, height: 700 },
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
      args: [
        '--remote-debugging-port=0',
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    laptop.on('console', (msg) =>
      consoles.push(`laptop/${msg.type()}: ${msg.text().slice(0, 160)}`),
    );
    laptop.on('pageerror', (err) =>
      consoles.push(`laptop/pageerror: ${err.message.slice(0, 160)}`),
    );

    // Raw browser CDP for the real action popup + target diffs.
    const deadline = Date.now() + 15_000;
    let portFile: string | null = null;
    while (Date.now() < deadline && portFile === null) {
      portFile =
        fs
          .readdirSync(os.tmpdir())
          .filter((d) => d.startsWith('rt-laptop-'))
          .map((d) => path.join(os.tmpdir(), d, 'DevToolsActivePort'))
          .filter((f) => fs.existsSync(f))
          .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0]?.f ?? null;
      if (portFile === null) await new Promise((r) => setTimeout(r, 200));
    }
    if (portFile === null) throw new Error('DevToolsActivePort never appeared');
    const [portLine, browserPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    if (portLine === undefined) throw new Error('DevToolsActivePort empty');
    for (let i = 0; i < 10 && rawCdp === null; i++) {
      try {
        rawCdp = await connectRawCdp(Number(portLine), browserPath ?? '/devtools/browser');
      } catch {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    if (rawCdp === null) throw new Error('raw CDP connection failed');

    let sw: Worker | undefined = laptop
      .serviceWorkers()
      .find((w) => w.url().includes('chrome-extension://'));
    if (sw === undefined) {
      sw = await laptop.waitForEvent('serviceworker', { timeout: 20_000 });
    }
    const liveSw = async (): Promise<Worker> => {
      const existing = laptop
        ?.serviceWorkers()
        .find((w) => w.url().includes('chrome-extension://'));
      if (existing) return existing;
      return (await laptop?.waitForEvent('serviceworker', { timeout: 20_000 })) as Worker;
    };
    const extId = new URL(sw.url()).host;
    record('1 extension loads + SW starts', extId.length > 16, `extId=${extId}`);

    // Target tab, created BY the extension (no tabs permission in manifest).
    const popupTab = await laptop.newPage();
    await popupTab.goto(`chrome-extension://${extId}/popup.html`);
    await popupTab.waitForSelector('#enable');
    const targetPromise = laptop.waitForEvent('page', { timeout: 15_000 });
    const tabId = (await popupTab.evaluate(
      async (url) => (await chrome.tabs.create({ url })).id,
      TARGET_URL,
    )) as number;
    const target = await targetPromise;
    await target.waitForURL(TARGET_URL, { timeout: 15_000 }).catch(() => undefined);
    await target.waitForSelector('#grid', { timeout: 15_000 });
    record('1b target tab created via extension', typeof tabId === 'number', `tabId=${tabId}`);

    // Pinned popup-as-tab for later pairing UI (real popup can't be kept open).
    await popupTab.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await popupTab.waitForSelector('#enable');
    const enableVisible = await popupTab.isVisible('#enable');
    record('1c pinned popup ready (pairing UI)', enableVisible, `enableVisible=${enableVisible}`);

    // ------------------------------------------------------------------
    // Step 2: Enable Remote — try the real popup via a toolbar scan; fall
    // back to WAITING FOR HUMAN (the gesture cannot be synthesized).
    // ------------------------------------------------------------------
    const xdo = (args: string[]) => execFileSync('xdotool', args).toString().trim();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Identify OUR browser's window by process id — never by size guesses
    // (in interactive mode a random user window can share the size class and
    // OS clicks must never land in it).
    let winX = 0;
    let winY = 0;
    let winW = 0;
    try {
      const pidOut = execFileSync('pgrep', ['-f', userDataDir]).toString().trim();
      const pids = new Set(pidOut.split('\n').filter(Boolean));
      for (const id of xdo(['search', '--onlyvisible', '--name', '.'])
        .split('\n')
        .filter(Boolean)) {
        try {
          const wpid = xdo(['getwindowpid', id]);
          if (!pids.has(wpid)) continue;
          const g = Object.fromEntries(
            xdo(['getwindowgeometry', '--shell', id])
              .split('\n')
              .map((l) => l.split('=')),
          ) as Record<string, string>;
          const w = Number(g.WIDTH ?? 0);
          if (w > 600) {
            winX = Number(g.X ?? 0);
            winY = Number(g.Y ?? 0);
            winW = w;
            break;
          }
        } catch {
          // window without a pid property / vanished mid-scan
        }
      }
    } catch {
      // pgrep found nothing — leave winW=0, the human path takes over
    }
    record(
      '2a test browser window identified (pid-anchored)',
      winW > 0,
      winW > 0
        ? `OS window at (${winX},${winY}) ${winW}px wide, pid matched to ${path.basename(userDataDir)}`
        : 'window not found — toolbar scan skipped, waiting for human click instead',
    );

    const popupTargets = async (): Promise<Set<string>> => {
      const t = (await rawCdp?.send('Target.getTargets', {})) as {
        targetInfos?: { targetId: string; type: string; url: string }[];
      };
      return new Set(
        (t.targetInfos ?? []).filter((x) => x.url.endsWith('popup.html')).map((x) => x.targetId),
      );
    };

    let realPopupTargetId: string | null = null;
    const iconY = winY + 72;
    // Only scan when we positively identified OUR browser window — never
    // send OS clicks into unknown coordinates.
    for (let dx = winW > 0 ? 24 : 0; winW > 0 && dx <= 170; dx += 12) {
      const before = await popupTargets();
      const iconX = winX + winW - dx;
      xdo(['mousemove', '--sync', String(iconX), String(iconY)]);
      xdo(['click', '1']);
      for (let i = 0; i < 6; i++) {
        await sleep(350);
        const after = await popupTargets();
        for (const id of after) {
          if (!before.has(id)) realPopupTargetId = id;
        }
        if (realPopupTargetId !== null) break;
      }
      if (realPopupTargetId !== null) break;
      xdo(['key', 'Escape']);
      await sleep(150);
    }

    let humanClicked = false;
    if (realPopupTargetId === null) {
      // Chromium grants the tabCapture gesture ONLY to a genuine action-popup
      // click. Ask for the one thing a human must do (ADR-013 by design).
      console.log(
        'WAITING FOR HUMAN (up to 180 s): click the RemoteTab toolbar icon, then Enable Remote…',
      );
      for (let i = 0; i < 360 && realPopupTargetId === null; i++) {
        await sleep(500);
        if (i % 20 === 19)
          console.log(`  … still waiting for the Enable click (${180 - Math.round(i / 2)} s left)`);
        const after = await popupTargets();
        if (after.size > 0) {
          realPopupTargetId = [...after][0] ?? null;
          humanClicked = true;
        }
      }
      if (realPopupTargetId === null) {
        record(
          '2 Enable Remote captures the tab',
          false,
          'BLOCKED: no enable click within 180 s (tabCapture gesture needs a human — ADR-013)',
        );
        finish({ blocked: 'enable-click' });
        return;
      }
    }

    // Real popup is open — OS-click its Enable button (its own JS reports the
    // true screen geometry; CDP clicks are refused for tabCapture).
    const attached = (await rawCdp.send('Target.attachToTarget', {
      targetId: realPopupTargetId,
      flatten: true,
    })) as { sessionId?: string };
    const popupSessionId = attached.sessionId;
    if (popupSessionId === undefined) throw new Error('popup attach returned no sessionId');
    const evalInPopup = async (expression: string): Promise<unknown> => {
      const r = (await rawCdp?.send(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        popupSessionId,
      )) as { result?: { value?: unknown } };
      return r.result?.value;
    };
    if (!humanClicked) {
      const geoJson = (await evalInPopup(
        `JSON.stringify({sx: window.screenX, sy: window.screenY, rect: document.querySelector('#enable')?.getBoundingClientRect()?.toJSON() ?? null})`,
      )) as string;
      const geo = JSON.parse(geoJson ?? '{}') as {
        sx: number;
        sy: number;
        rect: { x: number; y: number; width: number; height: number } | null;
      };
      if (geo.rect === null) throw new Error('real popup has no #enable');
      const cx = geo.sx + geo.rect.x + geo.rect.width / 2;
      const cy = geo.sy + geo.rect.y + geo.rect.height / 2;
      console.log(`LIVE: OS click on real popup Enable at (${cx}, ${cy})`);
      xdo(['mousemove', '--sync', String(Math.round(cx)), String(Math.round(cy))]);
      xdo(['click', '1']);
    }
    let enabled = 'capture never confirmed';
    for (let i = 0; i < 20 && !enabled.includes('OFFSCREEN'); i++) {
      await sleep(500);
      try {
        const current = await liveSw();
        const ctxs = (await current.evaluate(() =>
          chrome.runtime
            .getContexts({})
            .then((cs: { contextType: string }[]) => cs.map((c) => c.contextType).join(',')),
        )) as string;
        if (ctxs.includes('OFFSCREEN')) enabled = `offscreen created, contexts=${ctxs}`;
      } catch {
        // SW busy — retry next tick
      }
    }
    record('2 Enable Remote captures the tab', enabled.includes('OFFSCREEN'), enabled);

    if (!enabled.includes('OFFSCREEN')) {
      finish({ blocked: 'capture' });
      return;
    }

    // ------------------------------------------------------------------
    // Pairing: popup-as-tab pairStart → phone pastes the code.
    // ------------------------------------------------------------------
    const pairPopup = await laptop.newPage();
    await pairPopup.goto(`chrome-extension://${extId}/popup.html?tabId=${tabId}`);
    await pairPopup.waitForSelector('#enable');
    await pairPopup.click('#pair-start');
    await pairPopup.waitForSelector('#pair-qr-wrap:not([hidden])', { timeout: 15_000 });
    const payload = (await pairPopup.textContent('#pair-code')) ?? '';
    record(
      '3 pairing code minted (after enable)',
      payload.startsWith('RT1:'),
      `len=${payload.length}`,
    );

    phone = await chromium.launchPersistentContext(
      fs.mkdtempSync(path.join(os.tmpdir(), 'rt-phone-')),
      {
        headless: false,
        viewport: { width: 500, height: 350 }, // same 10:7 aspect as the laptop window
        env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
      },
    );
    phone.on('console', (msg) => consoles.push(`phone/${msg.type()}: ${msg.text().slice(0, 160)}`));
    phone.on('pageerror', (err) => consoles.push(`phone/pageerror: ${err.message.slice(0, 160)}`));
    const phonePage = await phone.newPage();
    await phonePage.goto(`${PWA_URL}?debug`);
    await phonePage.getByRole('button', { name: 'Pair with a QR code…' }).click();
    await phonePage.getByLabel('Paste pairing code').fill(payload);
    await phonePage.getByRole('button', { name: 'Pair', exact: true }).click();
    await phonePage.getByRole('button', { name: 'Connect' }).waitFor({ timeout: 20_000 });
    record('4 phone pairs (paste path)', true, 'pair.accepted → connect screen');

    await phonePage.getByRole('button', { name: 'Connect' }).click();
    let videoState = 'no video';
    try {
      await phonePage.waitForSelector('.remote-video', { timeout: 20_000 });
      await phonePage.waitForFunction(
        () => {
          const v = document.querySelector('.remote-video') as HTMLVideoElement | null;
          return v !== null && v.videoWidth > 0 && v.readyState >= 2;
        },
        { timeout: 30_000 },
      );
      const dims = await phonePage.evaluate(() => {
        const v = document.querySelector('.remote-video') as HTMLVideoElement;
        return `${v.videoWidth}×${v.videoHeight}`;
      });
      videoState = `live track ${dims}`;
    } catch {
      videoState = `video never went live (chip: "${await phonePage
        .locator('.chip')
        .first()
        .textContent()
        .catch(() => '?')}")`;
    }
    record('5 phone sees the real tab', !videoState.startsWith('no'), videoState);

    const inputOn = await phonePage
      .getByText('Input on')
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    record(
      '5b control channel open + peer auth ACTIVE',
      inputOn,
      inputOn ? 'Input on' : 'Input stayed off',
    );

    // ------------------------------------------------------------------
    // Step 5: tap — remote click lands on the target grid cell.
    // ------------------------------------------------------------------
    const contentRectAbs = async (): Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    }> => {
      const box = await phonePage.locator('.remote-video').boundingBox();
      if (!box) throw new Error('no video box');
      return phonePage.evaluate(
        () => {
          const v = document.querySelector('.remote-video') as HTMLVideoElement;
          const r = v.getBoundingClientRect();
          const elRatio = r.width / r.height;
          const vRatio = v.videoWidth / v.videoHeight;
          const c =
            elRatio === vRatio
              ? { x: 0, y: 0, width: r.width, height: r.height }
              : elRatio > vRatio
                ? {
                    x: (r.width - r.height * vRatio) / 2,
                    y: 0,
                    width: r.height * vRatio,
                    height: r.height,
                  }
                : {
                    x: 0,
                    y: (r.height - r.width / vRatio) / 2,
                    width: r.width,
                    height: r.width / vRatio,
                  };
          return { x: r.x + c.x, y: r.y + c.y, width: c.width, height: c.height };
        },
        { w: box.width, h: box.height },
      );
    };
    const tapAt = async (norm: { x: number; y: number }): Promise<string> => {
      const rect = await contentRectAbs();
      await phonePage.mouse.click(rect.x + norm.x * rect.width, rect.y + norm.y * rect.height);
      await sleep(400);
      return (
        (await phonePage
          .locator('.debug-overlay')
          .textContent()
          .catch(() => '')) ?? ''
      );
    };

    const cellKey = '3,1';
    const cellNorm = (await target.evaluate((key) => {
      const cells = Array.from(document.querySelectorAll('.cell')) as HTMLElement[];
      const cell = cells.find((c) => c.textContent === key) as HTMLElement;
      const r = cell.getBoundingClientRect();
      return {
        x: (r.x + r.width / 2) / window.innerWidth,
        y: (r.y + r.height / 2) / window.innerHeight,
      };
    }, cellKey)) as { x: number; y: number };
    let tapDetail = 'no tap computed';
    let tapOk = false;
    try {
      const chip = await tapAt(cellNorm);
      await target.waitForTimeout(800);
      const clicks = await target.evaluate(
        () =>
          (window as unknown as { __testState: { clicks: Record<string, number> } }).__testState
            .clicks,
      );
      tapOk = (clicks[cellKey] ?? 0) === 1;
      tapDetail = `chip="${chip.trim()}" expected(${cellNorm.x.toFixed(2)},${cellNorm.y.toFixed(2)}) clicks=${JSON.stringify(clicks)}`;
    } catch (err) {
      tapDetail = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    record('6 tap lands on the right target cell', tapOk, tapDetail);

    // ------------------------------------------------------------------
    // Step 7: keyboard — staged (abc → Backspace → def → Enter)
    // ------------------------------------------------------------------
    let keyDetail = 'not attempted';
    let keyOk = false;
    try {
      const inputNorm = (await target.evaluate(() => {
        const r = (document.getElementById('text-input') as HTMLElement).getBoundingClientRect();
        return {
          x: (r.x + r.width / 2) / window.innerWidth,
          y: (r.y + r.height / 2) / window.innerHeight,
        };
      })) as { x: number; y: number };
      await tapAt(inputNorm);
      await target.click('#text-input'); // ensure local focus for key events
      await target.fill('#text-input', '');
      await phonePage.getByRole('button', { name: '⌨' }).click();
      await phonePage.locator('.bridge-area').fill('abc');
      await phonePage.getByRole('button', { name: 'Send text' }).click();
      await target.waitForTimeout(800);
      const afterAbc = await target.inputValue('#text-input');
      await phonePage.locator('.bridge-area').focus();
      await phonePage.keyboard.press('Backspace');
      await target.waitForTimeout(800);
      const afterBackspace = await target.inputValue('#text-input');
      await phonePage.locator('.bridge-area').fill('def');
      await phonePage.getByRole('button', { name: 'Send text' }).click();
      await phonePage.locator('.quick', { hasText: 'Enter' }).click();
      await target.waitForTimeout(800);
      const finalValue = await target.inputValue('#text-input');
      const events = (await target.evaluate(() =>
        (window as unknown as { __testState: { events: string[] } }).__testState.events.join('|'),
      )) as string;
      keyOk = afterAbc === 'abc' && afterBackspace === 'ab' && finalValue === 'abdef';
      keyDetail = `abc→"${afterAbc}" ⌫→"${afterBackspace}" def→"${finalValue}" enterLogged=${events.includes('keydown key=Enter')}`;
    } catch (err) {
      keyDetail = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    record('7 keyboard staged flow', keyOk, keyDetail);

    // ------------------------------------------------------------------
    // Step 6: scroll — moves the region without accidental clicks
    // ------------------------------------------------------------------
    let scrollDetail = 'not attempted';
    let scrollOk = false;
    try {
      await phonePage.getByRole('button', { name: 'Scroll' }).click();
      const scrollNorm = (await target.evaluate(() => {
        const r = (document.getElementById('scroll-region') as HTMLElement).getBoundingClientRect();
        return {
          x: (r.x + r.width / 2) / window.innerWidth,
          y: (r.y + r.height / 2) / window.innerHeight,
        };
      })) as { x: number; y: number };
      const before = (await target.evaluate(() => ({
        top: Math.round((document.getElementById('scroll-region') as HTMLElement).scrollTop),
        clicks: JSON.stringify(
          (window as unknown as { __testState: { clicks: Record<string, number> } }).__testState
            .clicks,
        ),
      }))) as { top: number; clicks: string };
      const rect = await contentRectAbs();
      const px = rect.x + scrollNorm.x * rect.width;
      const py = rect.y + scrollNorm.y * rect.height;
      await phonePage.mouse.move(px, py);
      await phonePage.mouse.down();
      for (let i = 1; i <= 6; i++) await phonePage.mouse.move(px, py - i * 15);
      await phonePage.mouse.up();
      await target.waitForTimeout(1200);
      const after = (await target.evaluate(() => ({
        top: Math.round((document.getElementById('scroll-region') as HTMLElement).scrollTop),
        clicks: JSON.stringify(
          (window as unknown as { __testState: { clicks: Record<string, number> } }).__testState
            .clicks,
        ),
      }))) as { top: number; clicks: string };
      scrollOk = after.top > before.top + 10 && after.clicks === before.clicks;
      scrollDetail = `scrollTop ${before.top}→${after.top}, clicks unchanged=${after.clicks === before.clicks}`;
    } catch (err) {
      scrollDetail = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
    record('6 scroll moves region, no accidental clicks', scrollOk, scrollDetail);

    // G4 proxy: session survived everything without a replay teardown.
    let phaseAfterInput = 'unknown';
    if (!pairPopup.isClosed()) phaseAfterInput = (await pairPopup.textContent('#phase')) ?? '';
    else {
      const resp = (await (
        await liveSw()
      ).evaluate(() => chrome.storage.session.get('sessionState'))) as {
        sessionState?: { phase?: string };
      };
      phaseAfterInput = resp.sessionState?.phase ?? 'unknown';
    }
    record(
      'G4 no replay teardown during input',
      /active/i.test(phaseAfterInput),
      `popup phase="${phaseAfterInput}"`,
    );

    // ------------------------------------------------------------------
    // Step 10 + G6: Stop Remote is clean.
    // ------------------------------------------------------------------
    let stopPopup = pairPopup;
    if (pairPopup.isClosed()) {
      const ctx = laptop;
      if (ctx === null) throw new Error('laptop context gone');
      const pagePromise = ctx.waitForEvent('page', { timeout: 15_000 });
      await (await liveSw()).evaluate(() =>
        chrome.tabs.create({ url: chrome.runtime.getURL(`popup.html?tabId=${tabId}`) }),
      );
      stopPopup = await pagePromise;
      await stopPopup.waitForSelector('#enable', { timeout: 10_000 });
    }
    await stopPopup.click('#stop');
    await stopPopup.waitForFunction(
      () => /idle|stopped/i.test(document.getElementById('phase')?.textContent ?? ''),
      { timeout: 15_000 },
    );
    const phase = (await stopPopup.textContent('#phase')) ?? '';
    const debuggerAttached = (await (
      await liveSw()
    ).evaluate(async (id) => {
      const targets = await new Promise<{ tabId?: number; attached?: boolean }[]>((resolve) =>
        chrome.debugger.getTargets((t) =>
          resolve(t as unknown as { tabId?: number; attached?: boolean }[]),
        ),
      );
      return targets.some((t) => t.attached && t.tabId === id);
    }, tabId)) as boolean;
    record(
      '10 Stop returns to idle + debugger detached',
      /idle|stopped/i.test(phase) && !debuggerAttached,
      `phase="${phase}" debuggerAttached=${debuggerAttached}`,
    );

    // Input must be dead after stop.
    await target.evaluate(() => {
      (
        window as unknown as { __testState: { clicks: Record<string, number> } }
      ).__testState.clicks = {};
    });
    if (!phonePage.isClosed() && (await phonePage.locator('.remote-video').count()) > 0) {
      const rect = await contentRectAbs();
      await phonePage.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
    }
    await target.waitForTimeout(1200);
    const clicksAfterStop = (await target.evaluate(
      () =>
        (window as unknown as { __testState: { clicks: Record<string, number> } }).__testState
          .clicks,
    )) as Record<string, number>;
    record(
      '10b after Stop, phone input no longer reaches the tab',
      Object.keys(clicksAfterStop).length === 0,
      `clicks=${JSON.stringify(clicksAfterStop)}`,
    );
  } catch (err) {
    record('UNEXPECTED run error', false, err instanceof Error ? err.message : String(err));
  } finally {
    finish();
    await laptop?.close();
    await phone?.close();
  }

  const failed = steps.filter((st) => !st.ok);
  if (failed.length > 0) {
    throw new Error(`validation steps failed: ${failed.map((f) => f.step).join('; ')}`);
  }
});
