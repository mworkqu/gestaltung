#!/bin/bash
# Turns on the 5-minute health check (com.gestaltung.health).
# Only run this AFTER https://gestaltung360.com is served by this Mac, otherwise
# it will keep restarting the site because the public url is still on Vercel.
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
BASE="$HOME/Projects/gestaltung-company-webpage"
LABEL=com.gestaltung.health; PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$BASE/logs" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$BASE/live-scripts/mac-health.sh</string></array>
<key>EnvironmentVariables</key><dict>
 <key>HOME</key><string>$HOME</string>
 <key>PATH</key><string>$HOME/.local/node/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
</dict>
<key>StartInterval</key><integer>300</integer>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>$BASE/logs/health.out.log</string>
<key>StandardErrorPath</key><string>$BASE/logs/health.err.log</string>
</dict></plist>
PL
reload_agent "$LABEL" "$PLIST" || exit 1
echo "Health check on — every 5 minutes. Log: $BASE/logs/health.log"
