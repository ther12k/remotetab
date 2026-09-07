# UX Flows

## Laptop onboarding

```text
┌──────────────────────────────┐
│ RemoteTab                    │
├──────────────────────────────┤
│ Control one Chrome tab from  │
│ your phone.                  │
│                              │
│ Your browser login stays on  │
│ this computer.               │
│                              │
│ Permissions:                 │
│ • capture selected tab       │
│ • send remote input          │
│ • keep system awake          │
│                              │
│ [ Continue ]                 │
└──────────────────────────────┘
```

Explain the debugger permission directly rather than hiding it behind vague copy.

## Idle popup

```text
RemoteTab                    Idle

Current tab
ChatGPT
chatgpt.com

[ Enable Remote ]

Paired devices
Pixel 10                Revoke
```

Display sanitized origin only; omit sensitive URL query/fragment.

## First pairing

Laptop:

```text
Pair phone

Scan this code with RemoteTab.

[ QR ]

Expires in 04:58

[ Cancel ]
```

Phone:

```text
Pair a computer

[ camera ]

or enter pairing code
[ ________ ]
```

After scan, phone should display laptop name/fingerprint before final pairing.

## Connected viewer

```text
┌──────────────────────────────┐
│ ShieldTech Laptop     ● P2P  │
├──────────────────────────────┤
│                              │
│      streamed tab video      │
│                              │
├──────────────────────────────┤
│ ⌨ Keyboard  ↕ Scroll  Pointer│
└──────────────────────────────┘
```

## Interaction modes

Use two explicit modes to avoid ambiguous phone gestures:

### Pointer

- tap = left click;
- drag = pointer movement;
- optional long press = right-click only when enabled.

### Scroll

- one-finger vertical/horizontal motion becomes remote wheel.

Double tap can zoom the **viewer**, not the remote page.

## Keyboard bridge

After the user has tapped a visible remote text field:

```text
┌──────────────────────────────┐
│ remote video                 │
├──────────────────────────────┤
│ Type to remote focus...      │
│ [ local bridge textarea ]    │
│                              │
│ Esc Tab ↑ ↓ ← → Enter        │
│ [ Close keyboard ]           │
└──────────────────────────────┘
```

The local bridge is transport state, not a message-history store.

Do not retain sent text unnecessarily.

## Reconnecting

```text
Network changed.
Reconnecting securely…

Remote input paused.
[ Cancel ]
```

Input stays disabled until fresh peer authentication succeeds.

## Advanced diagnostics

Hide behind a secondary panel:

```text
Transport: TURN relay
RTT: 132 ms
Video: 960×600 @ 12 fps
Control buffer: healthy
```

Never show/log prompt content in diagnostics.

## Stop

If laptop stops:

```text
Remote session ended on laptop.
```

No silent reconnect until Remote Mode is enabled again.

## Revoked phone

```text
This computer revoked this device.
Pair again from the laptop to reconnect.
```

## Error copy

Prefer actionable messages.

Example:

```text
Remote input could not attach to this tab.
Chrome DevTools or another debugger may already be using it.
```

Never expose raw exception stacks to normal users.

## Privacy indicator

Laptop must visibly show Remote Mode/capture state.

The product must not try to hide capture, debugger attachment, or keep-awake activity.
