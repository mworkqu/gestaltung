#!/bin/bash
# Puts this Mac's site on https://gestaltung360.com through a free Cloudflare Tunnel.
# Before running: gestaltung360.com must be added to your (free) Cloudflare
# account AND the nameservers at Squarespace must already point to Cloudflare.
set -euo pipefail

# bootout is not instantaneous: bootstrapping again too soon fails with
# "Input/output error". Wait for the label to actually go away, then retry.
reload_agent() {
  local label="$1" plist="$2" i
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  for i in $(seq 1 25); do
    launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 || break
    sleep 0.2
  done
  for i in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "could not start $label — try: launchctl bootstrap gui/$(id -u) $plist"
  return 1
}
export PATH="$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
BASE="$HOME/Projects/gestaltung-company-webpage"; mkdir -p "$BASE/logs" "$HOME/.local/bin"
CF="$HOME/.local/bin/cloudflared"; NAME=gestaltung-mac

if [ ! -x "$CF" ]; then
  echo "Installing cloudflared (Apple Silicon)..."
  TMPD=$(mktemp -d /tmp/cfdl.XXXXXX)
  curl -fsSL --retry 3 -o "$TMPD/cf.tgz" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz
  tar -xzf "$TMPD/cf.tgz" -C "$TMPD"
  install -m 0755 "$TMPD/cloudflared" "$CF"
  rm -rf "$TMPD"
fi
"$CF" --version

# 1. Sign in once. A browser opens; pick gestaltung360.com.
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  echo "A browser will open — sign in to Cloudflare and authorise gestaltung360.com"
  "$CF" tunnel login
fi

# 2. Create the tunnel (once).
if ! "$CF" tunnel info "$NAME" >/dev/null 2>&1; then
  echo "Creating tunnel $NAME..."
  "$CF" tunnel create "$NAME"
fi
ID=$("$CF" tunnel list -o json | /usr/bin/python3 -I -c \
  'import sys,json;print(next(t["id"] for t in json.load(sys.stdin) if t["name"]==sys.argv[1]))' "$NAME")
CRED="$HOME/.cloudflared/$ID.json"
[ -f "$CRED" ] || { echo "Missing tunnel credentials $CRED — delete the tunnel in Cloudflare and run this again."; exit 1; }
echo "tunnel $NAME = $ID"

# 3. Config: both hostnames go to the local site, everything else 404.
#    The original Host header is passed through, so the app's own
#    www -> apex redirect still fires.
cat > "$HOME/.cloudflared/config.yml" <<CFG
tunnel: $ID
credentials-file: $CRED
loglevel: info
metrics: 127.0.0.1:20241
ingress:
  - hostname: gestaltung360.com
    service: http://127.0.0.1:3000
  - hostname: www.gestaltung360.com
    service: http://127.0.0.1:3000
  - service: http_status:404
CFG
"$CF" tunnel ingress validate

# 4. DNS: point both names at the tunnel.
"$CF" tunnel route dns --overwrite-dns "$NAME" gestaltung360.com
"$CF" tunnel route dns --overwrite-dns "$NAME" www.gestaltung360.com

# 5. Keep it running and bring it back after a reboot.
LABEL=com.gestaltung.tunnel; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array>
 <string>$CF</string><string>--config</string><string>$HOME/.cloudflared/config.yml</string>
 <string>--no-autoupdate</string><string>tunnel</string><string>run</string><string>$NAME</string>
</array>
<key>EnvironmentVariables</key><dict>
 <key>HOME</key><string>$HOME</string>
 <key>PATH</key><string>$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>$BASE/logs/tunnel.log</string>
<key>StandardErrorPath</key><string>$BASE/logs/tunnel.log</string>
</dict></plist>
PL
reload_agent "$LABEL" "$PLIST" || exit 1

echo "Waiting for the tunnel..."
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://gestaltung360.com/ || true)
  case "$code" in 200|307|308) break;; esac
  sleep 3
done
echo "gestaltung360.com answered HTTP ${code:-000}"
curl -s -o /dev/null -w 'www.gestaltung360.com answered HTTP %{http_code} -> %{redirect_url}\n' --max-time 10 https://www.gestaltung360.com/ || true
echo "If these are not right yet, DNS can take a little while after the nameserver change."
echo "Then turn on the health check: 4-start-health-check.command"
