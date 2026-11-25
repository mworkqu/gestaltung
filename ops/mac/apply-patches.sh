#!/bin/bash
# Re-applies the self-hosting patches to the live worktree.
# These are the changes that origin/main does not have yet, because they only
# matter when the site runs on this Mac instead of on Vercel. Every patch here
# should either be merged upstream or dropped once upstream has it.
set -uo pipefail
BASE="$HOME/Projects/gestaltung-company-webpage"
LIVE="$BASE/gestaltung-live"; PATCHES="$BASE/live-scripts/patches"
rc=0
shopt -s nullglob
for p in "$PATCHES"/*.patch; do
  name=$(basename "$p")
  if git -C "$LIVE" apply --reverse --check "$p" >/dev/null 2>&1; then
    echo "patch already applied: $name"
  elif git -C "$LIVE" apply "$p" >/dev/null 2>&1; then
    echo "patch applied:         $name"
  else
    echo "PATCH FAILED:          $name  (upstream changed these lines — re-make the patch by hand)"
    rc=1
  fi
done
exit $rc
