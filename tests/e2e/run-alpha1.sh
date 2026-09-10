#!/usr/bin/env bash
# 0.1.0-alpha.1 validation runner.
#
# Default: isolated Xvfb display (:99) — fully unattended, but the tabCapture
# gesture step will wait 180 s for a click no one can make there, so it ends
# BLOCKED at step 2 by design (ADR-013).
#
# Interactive (recommended for the real validation): run on your desktop so
# you can click the RemoteTab toolbar icon + Enable Remote when prompted:
#   RT_DISPLAY=:1 tests/e2e/run-alpha1.sh
# The harness does everything else automatically — pairing, connection,
# tap/keyboard/scroll against the test page, and clean-Stop checks.
set -uo pipefail
cd "$(dirname "$0")/../.."

DISPLAY_NUM=${RT_DISPLAY:-99}
export DISPLAY=":$DISPLAY_NUM"

if [ "$DISPLAY_NUM" != "99" ]; then
  echo ">>> INTERACTIVE MODE: browser windows will open on display $DISPLAY."
  echo ">>> When you see 'WAITING FOR HUMAN', click the RemoteTab toolbar icon"
  echo ">>> and press Enable Remote. Everything after that runs automatically."
  if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "display $DISPLAY not reachable"; exit 2
  fi
else
  if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    Xvfb "$DISPLAY" -screen 0 1600x1000x24 > /tmp/rt-xvfb.log 2>&1 &
    for _ in $(seq 1 25); do
      xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
      sleep 0.2
    done
    echo "started isolated Xvfb $DISPLAY"
  else
    echo "reusing existing Xvfb $DISPLAY"
  fi
fi

bunx playwright test -c tests/e2e/playwright.config.ts tests/e2e/alpha1-validation.spec.ts "$@"
