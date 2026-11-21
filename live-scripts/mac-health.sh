#!/bin/bash
# Health check for the self-hosted site. Run every 5 minutes by launchd
# (com.gestaltung.health). Checks the PUBLIC url; after 3 failures in a row it
# restarts the site, and sends at most ONE email per day.
#
# Manual use:  ./mac-health.sh            normal check
#              ./mac-health.sh --dry-run  check + report, never restart, never email
set -uo pipefail
export PATH="$HOME/.local/node/bin:/usr/bin:/bin:/usr/sbin:/sbin"

BASE="$HOME/Projects/gestaltung-company-webpage"
LIVE="$BASE/gestaltung-live"
LOGD="$BASE/logs"; mkdir -p "$LOGD"
LOG="$LOGD/health.log"
FAILFILE="$LOGD/health-fails"           # consecutive failure count
MAILSTAMP="$LOGD/health-last-email"     # YYYY-MM-DD of the last alert email
PUBLIC_URL="https://gestaltung360.com/"
LOCAL_URL="http://127.0.0.1:3000/"
SITE_LABEL="com.gestaltung.site"
TUNNEL_LABEL="com.gestaltung.tunnel"
THRESHOLD=3
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG"; }

# A url is healthy if it answers 200 or a redirect.
probe() { curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null || echo 000; }
healthy() { case "$1" in 200|301|302|307|308) return 0;; *) return 1;; esac; }

# The public probe resolves the hostname itself through a public resolver
# instead of trusting this Mac's DNS cache. Right after a nameserver change the
# local cache can still hold the OLD address for hours, which would make a
# perfectly healthy site look dead and trigger a pointless restart.
probe_public() {
  host=$(printf '%s' "$PUBLIC_URL" | sed -e 's|^https://||' -e 's|/.*$||')
  ip=$(dig +short +time=3 +tries=1 "$host" @1.1.1.1 2>/dev/null | grep -E '^[0-9.]+$' | head -1)
  if [ -n "$ip" ]; then
    curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
      --resolve "$host:443:$ip" "$PUBLIC_URL" 2>/dev/null || echo 000
  else
    probe "$PUBLIC_URL"
  fi
}

PUB=$(probe_public); LOC=$(probe "$LOCAL_URL")

# One alert email a day, through the Resend setup already in .env.local.
send_email() {
  local subject="$1" body="$2" today key from to
  today=$(date '+%Y-%m-%d')
  [ "$(cat "$MAILSTAMP" 2>/dev/null)" = "$today" ] && { log "email: already sent today, skipping"; return 0; }
  [ -f "$LIVE/.env.local" ] || { log "email: no .env.local, skipping"; return 0; }
  key=$(sed -n 's/^RESEND_API_KEY=//p' "$LIVE/.env.local" | tail -1 | tr -d '"'"'"'\r')
  from=$(sed -n 's/^RESEND_FROM=//p' "$LIVE/.env.local" | tail -1 | tr -d '"'"'"'\r')
  to=$(sed -n 's/^STORE_LEAD_EMAIL=//p' "$LIVE/.env.local" | tail -1 | tr -d '"'"'"'\r')
  [ -n "$from" ] || from="Gestaltung <onboarding@resend.dev>"
  [ -n "$to" ] || to="info@gestaltung360.com"
  if [ -z "$key" ]; then
    log "email: RESEND_API_KEY is not set in .env.local — no email sent (alert is in this log only)"
    return 0
  fi
  if [ "$DRY" = 1 ]; then log "email: DRY RUN, would email $to: $subject"; return 0; fi
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -X POST https://api.resend.com/emails \
    -H "Authorization: Bearer $key" -H "Content-Type: application/json" \
    --data-binary @<(/usr/bin/python3 -I -c 'import json,sys;print(json.dumps({"from":sys.argv[1],"to":[sys.argv[2]],"subject":sys.argv[3],"text":sys.argv[4]}))' "$from" "$to" "$subject" "$body") \
    2>/dev/null || echo 000)
  if [ "$code" = "200" ] || [ "$code" = "202" ]; then
    printf '%s\n' "$today" > "$MAILSTAMP"; log "email: sent to $to (HTTP $code)"
  else
    log "email: send failed (HTTP $code)"
  fi
}

if healthy "$PUB"; then
  prev=$(cat "$FAILFILE" 2>/dev/null || echo 0)
  printf '0\n' > "$FAILFILE"
  [ "$prev" != "0" ] && log "OK  public=$PUB local=$LOC (recovered after $prev failure(s))" || log "OK  public=$PUB local=$LOC"
  exit 0
fi

fails=$(( $(cat "$FAILFILE" 2>/dev/null || echo 0) + 1 ))
printf '%s\n' "$fails" > "$FAILFILE"
log "FAIL public=$PUB local=$LOC (consecutive=$fails/$THRESHOLD)"

[ "$fails" -lt "$THRESHOLD" ] && exit 1

if [ "$DRY" = 1 ]; then
  log "DRY RUN: would restart $SITE_LABEL (and $TUNNEL_LABEL if the local site is healthy)"
else
  log "restarting $SITE_LABEL after $fails consecutive failures"
  launchctl kickstart -k "gui/$(id -u)/$SITE_LABEL" 2>>"$LOG" || log "kickstart $SITE_LABEL failed"
  # If the site answers locally, the break is in the tunnel, not the app.
  if healthy "$LOC"; then
    log "local site is healthy, so also restarting $TUNNEL_LABEL"
    launchctl kickstart -k "gui/$(id -u)/$TUNNEL_LABEL" 2>>"$LOG" || log "kickstart $TUNNEL_LABEL failed (is the tunnel set up yet?)"
  fi
fi

send_email "gestaltung360.com is down (Mac mini)" \
"The health check on mohmmads-mac-mini failed $fails times in a row.

public  $PUBLIC_URL -> HTTP $PUB
local   $LOCAL_URL -> HTTP $LOC

$SITE_LABEL has been restarted. Log: $LOG
At most one of these emails is sent per day."

printf '0\n' > "$FAILFILE"
exit 1
