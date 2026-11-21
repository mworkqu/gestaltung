#!/bin/bash
# Voltaat price/stock sync — the Vercel cron "0 3 * * *" (UTC), i.e. 06:00 Qatar.
# Called by launchd (com.gestaltung.cron.voltaat). Hits the local server directly,
# so it still runs if the Cloudflare tunnel is down.
#
# The route refuses a second run inside 20 h on its own (returns already_ran_today),
# so a missed firing that launchd replays later cannot double-sync.
set -u
BASE="$(cd "$(dirname "$0")/.." && pwd)"
ENV="$BASE/gestaltung-live/.env.local"
LOG="$BASE/logs/cron-voltaat.log"
URL="http://127.0.0.1:3000/api/cron/voltaat-sync"
mkdir -p "$BASE/logs"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*" >> "$LOG"; }

SECRET=$(sed -n 's/^CRON_SECRET=//p' "$ENV" | head -1 | tr -d '"'"'"'\r')
if [ -z "${SECRET:-}" ]; then
  log "ERROR CRON_SECRET missing from .env.local — not calling the route"
  exit 1
fi

BODY=$(curl -sS --max-time 600 -o - -w '\n__CODE__%{http_code}' \
  -H "Authorization: Bearer $SECRET" "$URL" 2>&1)
CODE=${BODY##*__CODE__}
BODY=${BODY%$'\n'__CODE__*}

# Never let the secret reach the log, whatever the route echoes back.
BODY=${BODY//$SECRET/[redacted]}
log "HTTP $CODE ${BODY:0:500}"
case "$CODE" in 200|204) exit 0;; *) exit 1;; esac
