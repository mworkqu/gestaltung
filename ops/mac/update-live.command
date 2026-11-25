#!/bin/bash
# Updates the live site on this Mac to the latest origin/main.
# The new build is made in a separate folder, so if anything fails the site that
# is currently running is left exactly as it is.
#   ./update-live.command           update if origin/main moved
#   ./update-live.command --force   rebuild even if it did not
#   ./update-live.command --full    also run npm ci even if the lockfile is unchanged
set -uo pipefail
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

BASE="$HOME/Projects/gestaltung-company-webpage"
SRC="$BASE/gestaltung"; LIVE="$BASE/gestaltung-live"
LABEL=com.gestaltung.site
LOGD="$BASE/logs"; mkdir -p "$LOGD"
exec > >(tee -a "$LOGD/update.log") 2>&1

FORCE=0; FULL=0
for a in "$@"; do case "$a" in --force) FORCE=1;; --full) FULL=1;; esac; done

say() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$*"; }
die() { say "ERROR: $*"; exit 1; }

say "== update-live starting =="
[ -d "$LIVE" ] || die "$LIVE does not exist — run 1-build-live-site.command first."

OLD_SHA=$(git -C "$LIVE" rev-parse HEAD) || die "cannot read the live worktree"
say "live is at $OLD_SHA"

git -C "$SRC" fetch origin main || die "git fetch failed"
NEW_SHA=$(git -C "$SRC" rev-parse FETCH_HEAD) || die "cannot read origin/main"
say "origin/main is at $NEW_SHA"

if [ "$OLD_SHA" = "$NEW_SHA" ] && [ "$FORCE" = 0 ]; then
  say "already up to date — nothing to do (use --force to rebuild anyway)"; exit 0
fi

# Does the lockfile change? If not we can skip npm ci, which is the one step
# that would disturb the running server's node_modules.
NEED_CI=$FULL
if [ "$FULL" = 0 ]; then
  if ! git -C "$LIVE" diff --quiet "$OLD_SHA" "$NEW_SHA" -- package-lock.json package.json 2>/dev/null; then
    NEED_CI=1
  fi
fi

say "updating the source checkout to $NEW_SHA"
# --force, because the self-hosting patches below are uncommitted edits in this
# worktree and would otherwise block the checkout.
git -C "$LIVE" checkout --force --detach "$NEW_SHA" || die "checkout failed — the running site was not touched"
cp "$SRC/.env.local" "$LIVE/.env.local" || die "could not copy .env.local"

say "re-applying the self-hosting patches"
if ! "$BASE/live-scripts/apply-patches.sh"; then
  git -C "$LIVE" checkout --force --detach "$OLD_SHA" >/dev/null 2>&1
  "$BASE/live-scripts/apply-patches.sh" >/dev/null 2>&1
  die "a patch in live-scripts/patches did not apply to $NEW_SHA. Nothing was built, the running site is untouched."
fi

restore_source() { git -C "$LIVE" checkout --force --detach "$OLD_SHA" >/dev/null 2>&1 && "$BASE/live-scripts/apply-patches.sh" >/dev/null 2>&1 && say "source rolled back to $OLD_SHA"; }

if [ "$NEED_CI" = 1 ]; then
  say "lockfile changed — running npm ci"
  if ! (cd "$LIVE" && npm ci); then
    restore_source; die "npm ci failed. The running site is still serving the old build, but node_modules may be incomplete — run 1-build-live-site.command to repair."
  fi
else
  say "lockfile unchanged — skipping npm ci"
fi

say "building into .next-build (the running site keeps using .next)"
rm -rf "$LIVE/.next-build"
if ! (cd "$LIVE" && NODE_ENV=production NEXT_DIST_DIR=.next-build npm run build); then
  rm -rf "$LIVE/.next-build"; restore_source
  say "BUILD FAILED — nothing was swapped and $LABEL was NOT restarted."
  say "The site that is running is untouched and still serving $OLD_SHA."
  exit 1
fi
say "build OK"

say "swapping in the new build"
rm -rf "$LIVE/.next.old"
mv "$LIVE/.next" "$LIVE/.next.old" || die "could not move the old build aside"
mv "$LIVE/.next-build" "$LIVE/.next" || { mv "$LIVE/.next.old" "$LIVE/.next"; die "could not move the new build into place"; }

# `next build` with NEXT_DIST_DIR rewrites these two generated files to point at
# the staging folder. Put them back so the checkout stays clean.
git -C "$LIVE" checkout -- tsconfig.json next-env.d.ts 2>/dev/null || true

# Restart through 2-start-site.command rather than a bare kickstart, so the agent
# plist is rewritten too (it carries the commit sha the footer shows).
say "restarting $LABEL"
"$BASE/live-scripts/2-start-site.command" >/dev/null 2>&1 || say "WARNING: the start script reported a problem"

code=000
for _ in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/ || true)
  case "$code" in 200|307|308) break;; esac
  sleep 2
done

case "$code" in
  200|307|308)
    say "site answered HTTP $code — now live on $NEW_SHA"
    say "previous build kept at $LIVE/.next.old"
    exit 0;;
  *)
    say "the new build answered HTTP $code — rolling back to $OLD_SHA"
    rm -rf "$LIVE/.next-failed"; mv "$LIVE/.next" "$LIVE/.next-failed"
    mv "$LIVE/.next.old" "$LIVE/.next"
    restore_source
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
    for _ in $(seq 1 30); do
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/ || true)
      case "$code" in 200|307|308) break;; esac; sleep 2
    done
    say "after rollback the site answered HTTP $code (failed build kept at $LIVE/.next-failed)"
    exit 1;;
esac
