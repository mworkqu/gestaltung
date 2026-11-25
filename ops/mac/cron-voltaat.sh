#!/bin/bash
# Voltaat price/stock sync — one batch. Called hourly by launchd
# (com.gestaltung.cron.voltaat). Hits the local server directly, so it still
# runs if the Cloudflare tunnel is down.
#
# The route makes at most ONE request to Voltaat per call (robots.txt, then one
# catalogue page per batch) and decides by itself whether this call does
# anything: it answers "skipped" without contacting Voltaat when today's pass
# is finished, when the last batch was under 40 minutes ago, or while it is
# waiting out a refusal. So a missed or repeated firing cannot do damage.
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

# Spread the firing across the minute as well as across the hour.
# launchd's StartCalendarInterval has no Second field, so 5-start-voltaat-cron
# randomises the MINUTE per hour but every firing still lands exactly on :00
# seconds — a round clock tick is exactly what an automated client looks like.
# Sleeping a random 0-59 s means our one request a day-part arrives at a time
# no one could predict to the second. The config check above runs first, so a
# missing secret is still reported immediately instead of a minute later.
JITTER=$((RANDOM % 60))
log "waiting ${JITTER}s before the request"
sleep "$JITTER"

BODY=$(curl -sS --max-time 600 -o - -w '\n__CODE__%{http_code}' \
  -H "Authorization: Bearer $SECRET" "$URL" 2>&1)
CODE=${BODY##*__CODE__}
BODY=${BODY%$'\n'__CODE__*}

# Never let the secret reach the log, whatever the route echoes back.
BODY=${BODY//$SECRET/[redacted]}
log "HTTP $CODE ${BODY:0:500}"
case "$CODE" in 200|204) exit 0;; *) exit 1;; esac
