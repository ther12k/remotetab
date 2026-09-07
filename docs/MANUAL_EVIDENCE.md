# Manual Evidence Log

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
