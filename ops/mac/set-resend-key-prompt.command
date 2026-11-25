#!/bin/bash
# Interactive version: reads the key from the terminal itself (/dev/tty), so it
# works when launched into a real terminal tab. Paste at the prompt and press
# Enter. The key is not echoed, not in shell history, not an argument.
set -uo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$BASE/gestaltung/.env.local"
LIVE="$BASE/gestaltung-live/.env.local"
LABEL="com.gestaltung.site"

if [ ! -t 0 ] && [ ! -e /dev/tty ]; then
  echo "No terminal attached. Run this inside a terminal tab."; exit 1
fi
printf 'Paste the Resend API key here and press Enter.\nIt will NOT appear as you paste: '
IFS= read -rs KEY < /dev/tty
echo
KEY="$(printf '%s' "$KEY" | tr -d '\r\n[:space:]')"
[ -z "${KEY:-}" ] && { echo "Nothing received. No change made."; exit 1; }
case "$KEY" in
  re_*) ;;
  *) echo "That is not a Resend key (they start with re_). Got ${#KEY} characters. No change made."; exit 1;;
esac
echo "Got a key: starts 're_', ${#KEY} characters."

set_key() {
  f="$1"
  [ -f "$f" ] || { echo "  missing, skipped: $f"; return; }
  cp "$f" "$f.bak.$(date +%Y%m%d%H%M%S)"
  tmp="$(mktemp)"
  grep -v '^RESEND_API_KEY=' "$f" > "$tmp"
  printf 'RESEND_API_KEY=%s\n' "$KEY" >> "$tmp"
  mv "$tmp" "$f"; chmod 600 "$f"
  echo "  set in $f"
}
set_key "$SRC"
set_key "$LIVE"
unset KEY

echo "Restarting the site..."
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || echo "  restart failed; run live-scripts/2-start-site.command"
sleep 6
echo "local site: HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/en)"
echo "Done. The key was never printed."
