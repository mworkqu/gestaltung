#!/bin/bash
# Runs the site on this Mac at http://127.0.0.1:3000, restarts it if it crashes,
# starts it again after a reboot/login, and keeps the Mac awake while it runs.
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
BASE="$HOME/Projects/gestaltung-company-webpage"; LIVE="$BASE/gestaltung-live"
NODE="$HOME/.local/node/bin/node"; LABEL=com.gestaltung.site
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$BASE/logs" "$HOME/Library/LaunchAgents"

[ -d "$LIVE/.next" ] || { echo "No build found in $LIVE/.next — run 1-build-live-site.command first."; exit 1; }
[ -f "$LIVE/server.mjs" ] || { echo "Missing $LIVE/server.mjs — run live-scripts/apply-patches.sh"; exit 1; }

# The footer shows the running commit. On Vercel this came from
# VERCEL_GIT_COMMIT_SHA, so we set the same variable from the live worktree.
SHA=$(git -C "$LIVE" rev-parse HEAD 2>/dev/null || echo "")

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>WorkingDirectory</key><string>$LIVE</string>
<key>ProgramArguments</key><array>
 <string>/usr/bin/caffeinate</string><string>-is</string>
 <string>$NODE</string><string>$LIVE/server.mjs</string>
</array>
<key>EnvironmentVariables</key><dict>
 <key>NODE_ENV</key><string>production</string>
 <key>HOME</key><string>$HOME</string>
 <key>PATH</key><string>$HOME/.local/node/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
 <key>SITE_HOST</key><string>127.0.0.1</string>
 <key>PORT</key><string>3000</string>
 <key>SITE_ORIGIN</key><string>https://gestaltung360.com</string>
 <key>VERCEL_GIT_COMMIT_SHA</key><string>$SHA</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>$BASE/logs/site.log</string>
<key>StandardErrorPath</key><string>$BASE/logs/site.err.log</string>
</dict></plist>
PL

reload_agent "$LABEL" "$PLIST" || exit 1

echo "Starting the site..."
code=000
for _ in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/ || true)
  case "$code" in 200|307|308) break;; esac
  sleep 2
done
echo "Home page answered HTTP $code"
case "$code" in
  200|307|308) echo "SITE RUNNING — http://127.0.0.1:3000";;
  *) echo "Problem — see $BASE/logs/site.err.log"; exit 1;;
esac
