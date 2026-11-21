# Security state of the Mac and the site — 2026-11-22

## The important thing
The Mac has **no inbound port open to the internet**. cloudflared makes an
OUTBOUND connection to Cloudflare and traffic comes back down it, so there is
nothing on your router to forward and nothing for a scanner to find. The app
itself listens on 127.0.0.1:3000 only (verified: a LAN-IP request is refused).

## Done
- `gestaltung-live/.env.local` was mode 644 (readable by any local account) -> now 600.
- Tunnel credentials in ~/.cloudflared are already 600/400.
- Checked: CRON_SECRET appears in no log file. cron-voltaat.sh also redacts it
  from anything the route echoes back.
- DNSSEC re-enabled: Cloudflare signs the zone, DS record (key tag 2371,
  algorithm 13, SHA-256) added at Squarespace. Google's resolver returns the
  `ad` flag, so the chain validates.
- Cloudflare rate limit: 150 requests / 10 s per IP, everything except
  /_next/static, action Block for 10 s. Free plan allows exactly one rule and
  only that window and action. Stops a flood at the edge, before the Mac.
- Cloudflare Full (strict) TLS + Always Use HTTPS.

## Firewall — DONE 2026-11-22 00:20
The macOS application firewall is ON and stealth mode is ON (the user entered
the password; verified with --getglobalstate / --getstealthmode). Re-tested
afterwards: all public URLs still 200, tunnel still connected, port 3000 still
loopback only. The firewall filters INBOUND connections, and the tunnel is an
OUTBOUND connection, so it does not affect the site.

Still worth confirming Remote Login (SSH) is off unless you use it:

    sudo systemsetup -getremotelogin

## Listening on the LAN (not the internet) — all normal, listed for completeness
- ControlCenter on 5000 + 7000 — AirPlay Receiver. Turn off in System Settings >
  General > AirDrop & Handoff if you don't use it.
- rapportd on 49152 — Handoff / Continuity.
- IPNExtension on 443 and two high ports — Tailscale.

## Cost
R2 Paid is on the account but the bucket is empty: 0 B stored, $0.00 billable,
and Cloudflare has never issued an invoice. The zone itself is the Free plan.

## Already good
- FileVault is On.
- Port 3000 is bound to 127.0.0.1 only.
- cloudflared metrics endpoint is bound to 127.0.0.1:20241 only.
