#!/bin/bash
# Sets RESEND_API_KEY in both env files from the CLIPBOARD, then restarts the site.
#
# Copy the key in Resend (Cmd-C), then run this. Nothing is typed, nothing is
# echoed, the key never appears as an argument or in shell history, and the
# clipboard is cleared afterwards so it does not linger.
#
# Writes BOTH files on purpose:
#   gestaltung/.env.local       source of truth; update-live.command copies FROM
#                               here on every deploy, so a key set only in the
#                               live file is wiped by the next deploy.
#   gestaltung-live/.env.local  what the running site reads right now.
set -uo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$BASE/gestaltung/.env.local"
LIVE="$BASE/gestaltung-live/.env.local"
LABEL="com.gestaltung.site"

KEY="$(pbpaste | tr -d '\r\n[:space:]')"
if [ -z "$KEY" ]; then
  echo "Clipboard is empty. Copy the Resend key first, then run this again."
  exit 1
fi
case "$KEY" in
  re_*) ;;
  *) echo "The clipboard does not hold a Resend key (they start with re_)."
     echo "Length found: ${#KEY}. Copy the key again, then re-run. No change made."
     exit 1;;
esac
echo "Found a Resend key on the clipboard: starts 're_', ${#KEY} characters."

set_key() {
  f="$1"
  if [ ! -f "$f" ]; then echo "  missing, skipped: $f"; return; fi
  cp "$f" "$f.bak.$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  grep -v '^RESEND_API_KEY=' "$f" > "$tmp"
  printf 'RESEND_API_KEY=%s\n' "$KEY" >> "$tmp"
  mv "$tmp" "$f"
  chmod 600 "$f"
  echo "  set in $f"
}
set_key "$SRC"
set_key "$LIVE"
unset KEY
printf '' | pbcopy
echo "Clipboard cleared."

echo "Restarting the site so it picks the key up..."
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || echo "  could not restart; run live-scripts/2-start-site.command"
sleep 6
echo "local site: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/en)"
echo
echo "Done. The key was never printed."
echo "Timestamped .bak files sit beside each env file; delete them once happy."
