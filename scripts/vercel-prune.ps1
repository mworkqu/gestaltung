# Removes every Vercel deployment of this project that has no alias (old previews
# and superseded production builds). Hobby "Function Storage" counts the function
# bundles of ALL retained deployments, so run this after each push:
#   .\scripts\vercel-prune.ps1
# Keeps: current production (aliased to the domains) and the latest deployment of
# each branch (aliased gestaltung-git-<branch>-...). Needs `vercel login` once.
vercel rm gestaltung --safe --yes
