#!/bin/sh
# Blocks: start the automation Chrome that @mn/blocks/browser connects to.
#
#   automation-chrome.sh                 # port 9222, profile ~/ChromeAutomation
#   PORT=9333 PROFILE_DIR=~/Other CHROME=/path/to/chrome automation-chrome.sh
#
# Idempotent: if the port already answers /json/version AND it is this profile
# (its DevToolsActivePort file names the same port) it says so and exits 0. If
# the port answers but it is some other Chrome, it exits 1. The debug port is
# loopback-only (headed Chrome binds 127.0.0.1 by default; the address flag is
# belt and braces): anyone who can reach it controls the logged-in browser.
# Chrome 136+ ignores --remote-debugging-port on the default profile, hence the
# dedicated folder; sign in to your sites in this window once. On macOS Chrome
# is started with `open -na` so it survives a launchd job exiting.
# See docs/decisions/browser.md.
set -u
PORT="${PORT:-9222}"
PROFILE_DIR="${PROFILE_DIR:-$HOME/ChromeAutomation}"
OS="$(uname -s)"
if [ "$OS" = Darwin ]; then
  DEFAULT_CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
  DEFAULT_CHROME="google-chrome"
fi
CHROME="${CHROME:-$DEFAULT_CHROME}"
URL="http://127.0.0.1:$PORT/json/version"

answers() { curl -fsS --max-time 2 "$URL" 2>/dev/null | grep -q webSocketDebuggerUrl; }
ours() { [ "$(head -n 1 "$PROFILE_DIR/DevToolsActivePort" 2>/dev/null)" = "$PORT" ]; }

if answers; then
  if ours; then
    echo "automation Chrome already running on 127.0.0.1:$PORT (profile $PROFILE_DIR)"
    exit 0
  fi
  echo "Port $PORT answers, but it is not the automation profile ($PROFILE_DIR has no matching DevToolsActivePort). Another Chrome is using it; quit it or set PORT." >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"
if [ "$OS" = Darwin ] && [ "${CHROME:-}" = "$DEFAULT_CHROME" ]; then
  open -na "Google Chrome" --args \
    --remote-debugging-port="$PORT" \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run --no-default-browser-check
else
  nohup "$CHROME" \
    --remote-debugging-port="$PORT" \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$PROFILE_DIR" \
    --no-first-run --no-default-browser-check \
    >/dev/null 2>&1 &
fi

i=0
while [ "$i" -lt 20 ]; do
  if answers && ours; then
    echo "automation Chrome started on 127.0.0.1:$PORT (profile $PROFILE_DIR)"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done
echo "Chrome did not open debug port $PORT within 20s (is the profile in use by another Chrome window?)" >&2
exit 1
