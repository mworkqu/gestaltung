#!/bin/bash
# Builds the LIVE site (origin/main) in its own folder, gestaltung-live.
# Your cad-champions working copy is never touched.
# For a routine update of a site that is already running, use update-live.command
# instead: it keeps the running site up while the new build is made.
set -euo pipefail
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
BASE="$HOME/Projects/gestaltung-company-webpage"
SRC="$BASE/gestaltung"; LIVE="$BASE/gestaltung-live"
mkdir -p "$BASE/logs"; exec > >(tee -a "$BASE/logs/build.log") 2>&1
echo "== build $(date) =="; echo "node $(node -v)"

git -C "$SRC" fetch origin main
SHA=$(git -C "$SRC" rev-parse FETCH_HEAD)
if [ -e "$LIVE/.git" ]; then
  git -C "$LIVE" checkout --force --detach "$SHA"
else
  git -C "$SRC" worktree add --detach "$LIVE" "$SHA"
fi
cp "$SRC/.env.local" "$LIVE/.env.local"

echo "-- self-hosting patches --"
"$BASE/live-scripts/apply-patches.sh" || { echo "A patch did not apply. Fix it before building."; exit 1; }

cd "$LIVE"; echo "building commit $(git log -1 --format='%h %s')"
npm ci
NODE_ENV=production npm run build
echo; echo "BUILD OK — now run 2-start-site.command"
