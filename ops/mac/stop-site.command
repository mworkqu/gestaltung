#!/bin/bash
# Stops the site, the tunnel and the health check on this Mac.
# They stay stopped until you run 2-start-site / 3-connect / 4-start-health-check again.
for L in com.gestaltung.health com.gestaltung.tunnel com.gestaltung.site; do
  if launchctl bootout "gui/$(id -u)/$L" 2>/dev/null; then echo "stopped $L"; else echo "$L was not running"; fi
done
