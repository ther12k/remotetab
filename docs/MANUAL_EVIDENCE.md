# Manual Evidence Log

## 0.1.0-alpha.1 validation script (MVP gate — do this FIRST)

Everything below the line is beta evidence (P2 work). This section is the
only thing gating 0.1.0-alpha.1. Follow the flow top to bottom and record
what actually happened — every failure is a P0 fix, not a discussion.

Setup:

```sh
bun install
bun run build:extension      # apps/extension/.output/chrome-mv3
bun run dev:signaling        # terminal 1 (default ws://localhost:8787/ws)
bun run dev:mobile           # terminal 2 — note the LAN URL printed by Vite
```

Load unpacked `apps/extension/.output/chrome-mv3` in Chrome; open the PWA on
the phone at the LAN URL; pair once via the popup QR.

Environment: Chrome ____, laptop OS ____, phone ____, Android/iOS ____.

The flow:

1. [ ] Extension loads; popup shows the current tab (sanitized origin only).
2. [ ] Click **Enable Remote** on the ChatGPT tab.
3. [ ] Phone connects (laptop code or existing pair).
4. [ ] Video appears on the phone — the REAL tab, live.
5. [ ] Tap works: tap the ChatGPT composer, focus lands in the real tab.
6. [ ] Scroll works: scroll mode moves the page without accidental clicks.
7. [ ] Keyboard works: type a message via the bridge — exact text lands in
       the composer.
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
      fresh session → control resumes
- [ ] G6 Stop Remote detaches the debugger (orange bar gone) + capture stops
      (chrome://media-internals) + keep-awake released
- [ ] G7 ChatGPT login/cookies only on the laptop; RemoteTab logs/traffic
      contain no credentials, no cookies, no scraped output

Result: ____ (all green → 0.1.0-alpha.1 ships to 2–5 people; any red → file
the failure as a P0 issue with the step number).

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
