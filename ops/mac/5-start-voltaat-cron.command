#!/bin/bash
# Schedules the Voltaat sync: one small batch an hour, never on the hour.
#
# Each firing makes at most ONE request to Voltaat (robots.txt, then one
# catalogue page per batch), so the day's pass is ~8 requests spread over ~8
# hours, starting after midnight Qatar time. Once the pass is finished the
# remaining firings are answered "already_ran_today" by the site itself and
# send nothing to Voltaat; they are there so a refused batch gets another try.
#
# The minute differs per hour and stays between :20 and :39, so two firings
# are always more than 40 minutes apart (the site refuses anything closer).
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.gestaltung.cron.voltaat"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$BASE/logs"

# One slot per hour; the minute is fixed per hour but not the same every hour.
MINUTES=(23 37 28 21 34 26 39 22 31 36 24 29 38 20 33 27 35 25 30 39 21 32 26 37)
SLOTS=""
for h in $(seq 0 23); do
  SLOTS+="    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>${MINUTES[$h]}</integer></dict>"$'\n'
done

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
  <array>
$SLOTS  </array>
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

echo "Scheduled: $LABEL hourly (minute :20-:39), one request to Voltaat per batch."
echo "Log: $BASE/logs/cron-voltaat.log"
