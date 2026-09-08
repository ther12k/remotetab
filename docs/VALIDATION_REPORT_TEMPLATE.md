# RemoteTab alpha.1 — validation failure report

Fill ONE report at the FIRST failure of a validation run. Do not debug while
improvising: run the 10 steps straight through, stop at the first red step,
capture this report, then start diagnosing. Two bugs that look identical in
the UI often have different sources — this template exists to separate them
in one pass (e.g. "tap doesn't work" could be coordinate mapping, a closed
DataChannel, peer auth not ACTIVE, SequenceGuard reject, debugger detached,
stale CSS viewport, or wrong touch→mouse conversion).

```
RemoteTab alpha.1 validation

Commit:
Chrome:
Laptop OS:
Phone:
Phone browser:
Network:

Failed step:
Expected:
Actual:

Extension popup state:
Extension service-worker console:
Phone console:
Signaling log:

WebRTC state:
ICE connection state:
DataChannel state:

Does video still move?:
Does pointer still work?:
Does keyboard still work?:

Repro:
1.
2.
3.
```

## Where to capture each field

- **Extension popup state** — screenshot of the popup (phase text + chips).
- **Extension service-worker console** — chrome://extensions → RemoteTab →
  "service worker" → Inspect. Set the console filter to **Verbose** during
  alpha runs: the coordinate instrumentation logs
  `[remotetab] pointer.down remote coordinate x=… y=… (viewport …)`.
- **Phone console** — connect the phone browser to desktop devtools (chrome://inspect
  on Android / Safari→Develop on iOS), or temporarily run the PWA on the
  laptop in a narrow window.
- **Signaling log** — the `bun run dev:signaling` terminal.
- **WebRTC / ICE / DataChannel state** — phone console:
  `pc` diagnostics from the Viewer's Diag panel (transport + RTT), plus
  `chrome://webrtc-internals` on the laptop for ICE state and DataChannel
  counters.
- **Pointer/keyboard sanity** — even when the failed step is video or
  connect: note whether the other two still work; that alone eliminates
  whole bug classes.

## Common "tap doesn't work" differential (check in this order)

1. Phone overlay (`?debug` URL param): does the tap show
   `tap 0.53, 0.81` or `tap REJECTED`? REJECTED = letterbox/out-of-bounds
   math (coordinate mapping bug class A/G).
2. Laptop SW console (Verbose): does `[remotetab] pointer.down remote
   coordinate x=… y=…` appear with sane numbers? Wrong numbers =
   mapping/viewport bug class A/F; no line at all = frame never arrived
   (class B/C/D) or was not dispatched (class E).
3. Popup phase: must be `remote-active` when tapping (class C/E).
4. SW console for `REPLAY_REJECTED` / teardown lines (class D).
5. The orange "being debugged" bar still visible on the tab (class E).
