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
