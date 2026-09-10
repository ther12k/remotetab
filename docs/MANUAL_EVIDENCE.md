# Manual Evidence Log

## 0.1.0-alpha.1 validation script (MVP gate — do this FIRST)

Everything below the line is beta evidence (P2 work). This section is the
only thing gating 0.1.0-alpha.1.

Run rules:

- Run the 10 steps STRAIGHT THROUGH, start to finish. Do not fix anything
  mid-run and do not improvise debugging.
- Stop at the FIRST failure and fill ONE report from
  docs/VALIDATION_REPORT_TEMPLATE.md (commit, Chrome, states, repro). That
  report — not a fix attempt — is the run's output.
- Only after the report is captured, diagnose (the template includes the
  "tap doesn't work" differential ordering).

Two ways to run it:

**A. Automated harness (recommended)** — `tests/e2e/run-alpha1.sh` drives real
Chrome on both sides: extension, pairing, connection, tap/keyboard/scroll on
the neutral test page, and clean-Stop checks, writing
`tests/e2e/results/alpha1-report.json`. Chromium only grants the tabCapture
gesture to a genuine human click on the real action popup (ADR-013 by
design), so the harness pauses at "WAITING FOR HUMAN" for exactly one click:

```sh
bun install && bun run build:extension
bun run dev:signaling        # terminal 1
bun run dev:mobile           # terminal 2
RT_DISPLAY=:1 tests/e2e/run-alpha1.sh   # opens on your desktop; you click Enable once
```

Without `RT_DISPLAY=:1` it runs on an isolated Xvfb and ends BLOCKED at the
enable step (nothing to click there) — still useful as a smoke test.

**B. Fully manual** — as described below.

Manual setup:

```sh
bun install
bun run build:extension      # apps/extension/.output/chrome-mv3
bun run dev:signaling        # terminal 1 (default ws://localhost:8787/ws)
bun run dev:mobile           # terminal 2 — note the LAN URL printed by Vite
```

Load unpacked `apps/extension/.output/chrome-mv3` in Chrome; open the PWA on
the phone at the LAN URL; pair once via the popup QR.

Alpha debug instrumentation (enable for every validation run):

- Phone: open the PWA with `?debug` in the URL (or set
  `localStorage.remotetab.debugCoords = '1'`). A green chip shows the last
  tap's normalized coordinates — `tap 0.53, 0.81` — or `tap REJECTED` when
  the touch landed in the letterbox, plus `video WxH → target WxH`.
- Laptop: in the service-worker console set the log level to **Verbose**;
  every tap logs `[remotetab] pointer.down remote coordinate x=763 y=729
  (viewport 1440×900, from 0.530,0.810)`.

Environment: Chrome ____, laptop OS ____, phone ____, Android/iOS ____.

The flow:

1. [ ] Extension loads; popup shows the current tab (sanitized origin only).
2. [ ] Click **Enable Remote** on the ChatGPT tab.
3. [ ] Phone connects (laptop code or existing pair).
4. [ ] Video appears on the phone — the REAL tab, live.
5. [ ] Tap works: tap the ChatGPT composer, focus lands in the real tab.
       Coordinate check (do once while here): tap the VISUAL CENTER of a
       large element; the phone chip should read ~0.50, 0.50 and the laptop
       verbose line should land near the center of the target. A consistent
       offset = mapping bug (report it — see template classes A/F/G).
6. [ ] Scroll works: scroll mode moves the page without accidental clicks.
7. [ ] Keyboard works — STAGED, in exactly this order (virtual keyboards
       reshape the layout; each stage isolates one failure):
       a. focus the remote composer with a tap
       b. open the keyboard bridge, send `abc` — exact text lands
       c. Backspace once — `ab` remains
       d. send `def` — composer shows `abcdef`
       e. only then try a real prompt
8. [ ] Enter works: send the prompt from the phone.
9. [ ] ChatGPT response becomes visible in the phone video (pixels only).
10. [ ] Disconnect works: Stop on the laptop OR Disconnect on the phone.

The seven gate blockers (RELEASE.md):

- [ ] G1 extension captures a real tab
- [ ] G2 phone receives the stream
- [ ] G3 tap/scroll/keyboard really work
- [ ] G4 whole session on one sequence space — ZERO REPLAY_REJECTED
      (first tap after pairing must NOT kill the session; watch the
      service-worker console)
- [ ] G5 simple reconnect: drop phone Wi-Fi 5–15 s → input pauses →
      fresh session → control resumes. Alpha bar is LOW: 2–5 s with a
      "Reconnecting" notice is fine; seamless frame continuity, instant
      ICE restart, and multi-path failover are NOT required yet.
- [ ] G6 Stop Remote is CLEAN — all six:
      - video frozen/disconnected on the phone
      - DataChannel closed (chrome://webrtc-internals counters stop)
      - RTCPeerConnection closed
      - debugger orange indicator GONE from the tab
      - capture stopped (chrome://media-internals shows the stream gone)
      - system keep-awake released
      A dirty stop poisons the NEXT session with false bugs (debugger
      conflict, stale stream) — treat any residue here as P0.
- [ ] G7 ChatGPT login/cookies only on the laptop; RemoteTab logs/traffic
      contain no credentials, no cookies, no scraped output

Result: ____ (all green → tag v0.1.0-alpha.1 — do NOT add polish first; any
red → the report becomes the single most important work item in the repo).

## After the first green run: tag, then hand to 2–5 people

1. Tag `v0.1.0-alpha.1` on the commit that passed.
2. Give testers ONE instruction, verbatim:
   "Coba lanjutkan percakapan ChatGPT dari HP dan kasih tahu bagian yang
   terasa rusak atau menyebalkan."
   Do NOT hand them a feature checklist — we want their unprompted
   annoyances ("scroll-nya aneh", "keyboard nutup layar", "susah klik
   textbox", "disconnect setelah layar HP mati", "text terasa telat").
3. Record their reports verbatim in this file; each becomes a P1 item
   ranked by how many people hit it.

---

# Beta evidence (P2 — record as worked)

Some acceptance criteria require a real Chrome install / real phone and
cannot be evidenced by CI. Record evidence here (Chrome version, OS, what
you saw) as issues are validated. Local checks that already pass are listed
in each issue's commit message.

## #006 — User-initiated active-tab capture (needs-manual-evidence)

Setup:

```sh
bun install
bun run build:extension      # produces apps/extension/.output/chrome-mv3
bun run dev:mobile           # separate issue, not needed yet
```

1. Open `chrome://extensions`, enable Developer mode, **Load unpacked** →
   select `apps/extension/.output/chrome-mv3`.
2. Record Chrome version + OS here.
3. Open any normal http(s) tab (e.g. a local test page), click the RemoteTab
   icon, then **Enable Remote**.
   - [ ] Popup shows `Enabled` and `Capture: active` (capture needs #007 to
     render anywhere, but the popup status row comes from live capture state).
   - [ ] `chrome://extensions` → RemoteTab → **service worker** console shows
     no errors; **offscreen.html** appears under "Inspect views".
4. Navigate the captured tab to another site.
   - [ ] Capture keeps running; no duplicate tracks (check
     `chrome://media-internals` — one live "tab_capture" stream).
5. Close the captured tab.
   - [ ] Popup error: "Remote tab was closed. Remote Mode stopped."
   - [ ] `offscreen.html` disappears from Inspect views.
6. Click **Stop Remote** on a fresh session.
   - [ ] All capture tracks end (media-internals shows stream gone).
7. Try Enable on `chrome://settings`.
   - [ ] Popup shows the "cannot be captured" message; state returns to Idle.

Browser/OS used: _(fill in)_

## #017 — TURN-only connectivity (needs-manual-evidence)

1. Deploy `infra/coturn` (see infra/coturn/README.md) and set TURN_SECRET +
   TURN_URLS on the signaling service.
2. Enable Remote on the laptop, connect the phone with the external network.
   - [ ] Diagnostics panel shows `transport: relay`.
   - [ ] Same flow with TURN unreachable shows `direct` (fallback intact).

## #020 — Release gate (needs-manual-evidence)

- [ ] Neutral-page E2E pass on real phone (grid clicks, text, Enter, scroll)
- [ ] Network-switch reconnect (Wi-Fi → mobile): input pauses, resumes after fresh proof
- [ ] Revoke active phone: session ends + reconnect refused
- [ ] 60-minute soak: no reconnect loop, no unbounded memory
- [ ] Real ChatGPT visual test: harmless message typed via phone, response
      observed as pixels only; logs/traffic contain no credentials or scraped
      output
- [ ] Stop releases debugger, keep-awake, tracks (chrome://media-internals)

Browser/OS/phone used: _(fill in)_ — decision recorded in RELEASE.md
