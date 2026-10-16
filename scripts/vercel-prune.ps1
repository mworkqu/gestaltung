# Removes every Vercel deployment of this project that has no alias (old previews
# and superseded production builds). Hobby "Function Storage" counts the function
# bundles of ALL retained deployments, so run this after each push:
#   .\scripts\vercel-prune.ps1
# Keeps: current production (aliased to the domains) and the latest deployment of
# each branch (aliased gestaltung-git-<branch>-...). Needs `vercel login` once.
#
# A deployment that is still building has no alias yet, so `vercel rm --safe`
# deletes it too and the build fails with "Deployment not found. Was it deleted?"
# (2026-10-16: three main builds lost that way). So: wait until nothing is
# Building / Queued / Initializing, then prune. Run it only after the push's
# build shows "Ready" in `vercel list gestaltung`.
$maxWaitMinutes = 10
for ($i = 0; $i -le $maxWaitMinutes * 2; $i++) {
  $listing = vercel list gestaltung 2>&1 | Out-String
  $inFlight = ($listing -split "`n") | Where-Object { $_ -match 'Building|Queued|Initializing' }
  if (-not $inFlight) { break }
  if ($i -eq $maxWaitMinutes * 2) {
    Write-Host "A deployment is still building after $maxWaitMinutes minutes; not pruning. Run again later."
    exit 1
  }
  Write-Host "A deployment is still building; waiting 30 s before pruning..."
  Start-Sleep -Seconds 30
}
vercel rm gestaltung --safe --yes
