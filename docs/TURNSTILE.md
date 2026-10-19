# Turnstile (bot check): setup, switch-on and switch-off

Cloudflare Turnstile is the "are you a human" check that can sit in front of sign-in, sign-up, password reset, starting a project as a guest, add-to-cart as a guest, the contact form and the first guest analysis. It is **free**. The code is already live and the switch is **OFF**, so the site behaves exactly as before until you follow the steps below in order.

Do not skip the order. Turning Supabase's CAPTCHA on before the code, keys and switch are ready makes **every sign-in, sign-up and guest session fail** (this happened once, 2026-09-18).

---

## Before you start: create the widget in your own Cloudflare account

Only you can do this; nobody should create an account for you.

1. Sign in (or sign up, free) at https://dash.cloudflare.com with your own account.
2. Left menu: **Turnstile** -> **Add widget**.
3. Widget name: `Gestaltung`.
4. Hostnames: add all four, one per line:
   - `gestaltung360.com`
   - `www.gestaltung360.com`
   - `gestaltung.vercel.app`
   - `localhost`
5. Widget mode: **Managed**. Pre-clearance: leave off.
6. **Create**. Cloudflare shows two values:
   - **Site key**: public, goes in the page.
   - **Secret key**: private. Never paste it in a chat, a document or into code.

---

## The 7 steps (in this order)

1. **Keys in Vercel.** Vercel -> project `gestaltung` -> Settings -> Environment Variables. Add for Production, Preview and Development:
   - `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = the site key. This one is read at **build time**, so it only takes effect after a new deploy (step 3).
   - `TURNSTILE_SECRET_KEY` = the secret key. Mark it **Sensitive**.
2. **Migration 0055.** Already run (2026-10-09). Nothing to do; the switch row exists and reads OFF.
3. **Redeploy.** Vercel -> Deployments -> the latest production deployment -> **Redeploy** (needed because the site key is read at build time).
4. **Switch it on.** Open the site dashboard -> **AI usage & pricing** -> **Bot check** -> turn the switch on. On the same card you can see whether both keys are present; if one is missing, stop and fix step 1.
5. **Verify in a private window** (fresh window, signed out): all of these must work and show the small check without blocking you:
   - sign in
   - sign up
   - forgot password (send the reset link)
   - start a new project ("Plan a product")
   - guest add-to-cart (add a part to the cart without signing in)
   - contact form (send a message)
   - guest analyse (run "Analyse brief" on a new guest project)

   If any of them fails, go to **Turning it off** below, then tell us which one.
6. **Only now: Supabase CAPTCHA.** Supabase dashboard -> **Authentication** -> **Attack Protection** -> turn on **Enable CAPTCHA protection**, provider **Cloudflare Turnstile**, paste the **same secret key** -> **Save**.
7. **Verify again** in a private window: sign in, sign up, forgot password and "Plan a product" as a guest (these are the calls Supabase now checks). All must still work.

---

## Turning it off

In this order (reverse of switching on):

1. **Supabase first**: Authentication -> Attack Protection -> turn **Enable CAPTCHA protection** off -> Save.
2. **Then the site switch**: dashboard -> AI usage & pricing -> Bot check -> off.

With the switch off the site is identical to before: no widget is shown and nothing is checked. You can leave the keys in Vercel.

If you ever turn the site switch off while Supabase CAPTCHA is still on, every auth call will fail until you turn Supabase's CAPTCHA off.

---

## What is NOT checked

These server endpoints do not ask for the bot check: `/api/bom/electronics`, `/api/brief-chat`, `/api/projects/name`, `/api/design-quote`. Do not expect the check to appear for them; the daily AI limits and the other server rules still apply. Adding the check to them would be a separate change.

---

## "I added the key in Vercel and nothing happened"

Adding `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on its own changes nothing on the live
site. Nothing breaks either — the widget simply never renders and every form
keeps working exactly as before. Walk down this list in order; it is almost
always the first or the second one.

1. **The switch is still off.** The keys are only half of it. The bot check is a
   row in the database (`store_settings.turnstile`) and it reads OFF until you
   turn it on: dashboard -> **AI usage & pricing** -> **Bot check** -> tick the
   box -> Save. A fresh project has never had it on.
2. **No redeploy since you added the key.** `NEXT_PUBLIC_` variables are baked
   into the JavaScript when the site is built, not read when a visitor loads the
   page. A variable added after the last build is invisible to the browser until
   you deploy again: Vercel -> Deployments -> latest Production -> **Redeploy**.
   The Bot check card now says so itself — if it shows an amber
   "redeploy needed" line, this is your problem.
3. **You are looking at a page cached before the change.** The switch is cached
   for 24 hours. Saving the switch clears that cache; a hard refresh
   (Ctrl+Shift+R) clears the browser's copy.
4. **The hostname is not on the Cloudflare widget.** If the widget renders but
   shows a Cloudflare error, the domain you are browsing is missing from the
   widget's hostname list (see the four hostnames above). Preview deploys on
   `*.vercel.app` need `gestaltung.vercel.app` listed.
5. **The variable is set for the wrong environment.** Production, Preview and
   Development are separate lists in Vercel. A key set only for Production will
   not appear on a preview deploy.

### Secret or Config?

Vercel offers two types. Either works for the build, so this is not a cause of
the problem above — but:

- **`TURNSTILE_SECRET_KEY`** -> **Secret**. It must never be readable.
- **`NEXT_PUBLIC_TURNSTILE_SITE_KEY`** -> **Config** is the better choice. The
  site key is public by design: it is shipped to every visitor's browser, so
  hiding it in the dashboard protects nothing and only stops you checking later
  what the value is. Vercel also refuses Secret variables in the **Development**
  environment, which step 1 of the setup asks for.
