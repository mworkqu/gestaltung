#!/bin/bash
# Schedules the Voltaat sync at 06:00 Qatar time (the Vercel cron was 03:00 UTC).
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.gestaltung.cron.voltaat"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$BASE/logs"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$BASE/live-scripts/cron-voltaat.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$BASE</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$BASE/logs/cron-voltaat.out.log</string>
  <key>StandardErrorPath</key><string>$BASE/logs/cron-voltaat.err.log</string>
</dict>
</plist>
PL

plutil -lint "$PLIST" >/dev/null

reload_agent() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  for _ in $(seq 1 25); do
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
    sleep 0.2
  done
  for i in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null; then return 0; fi
    sleep 1
  done
  echo "Could not load $LABEL. Try by hand:"
  echo "  launchctl bootstrap gui/$(id -u) $PLIST"
  return 1
}
reload_agent

echo "Scheduled: $LABEL at 06:00 Qatar time, daily."
echo "Log: $BASE/logs/cron-voltaat.log"
