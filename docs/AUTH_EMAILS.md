# Auth emails: from Gestaltung, not Supabase

Today the confirm-signup and password-reset emails are sent by Supabase's built-in sender (a Supabase address, plain default text, a very low hourly limit). This guide moves them to **Resend** (the account that already sends the order and contact emails) and replaces the default text with branded English + Arabic templates.

Nothing here changes the app code. It is two dashboard settings (SMTP, templates). Total time: about 15 minutes. Both dashboards are free; nothing here needs a paid plan.

---

## What you need

- Supabase dashboard access to the Gestaltung project.
- The Resend API key that is already in Vercel as `RESEND_API_KEY` (Resend dashboard -> API Keys; if you no longer have the value, create a new key with "Sending access" for the domain `contact.gestaltung360.com`, and update the Vercel variable too). Never paste the key in a chat or a document; paste it only into the Supabase password field.
- The Resend domain `contact.gestaltung360.com` is already verified, so no DNS work is needed.

---

## Part 1. Custom SMTP (the sender)

1. Open https://supabase.com/dashboard and select the Gestaltung project.
2. Left menu: **Project Settings** -> **Authentication** -> **SMTP Settings**. Turn on **Enable custom SMTP**.
3. Fill the fields exactly:

   | Field | Value |
   |-------|-------|
   | Sender email | `noreply@contact.gestaltung360.com` |
   | Sender name | `Gestaltung` |
   | Host | `smtp.resend.com` |
   | Port number | `465` |
   | Minimum interval between emails being sent | leave the default |
   | Username | `resend` |
   | Password | the Resend API key (the same value as `RESEND_API_KEY` in Vercel) |

4. **Save**. Supabase does not send a test email by itself; do the test in Part 4.

### Rate limits (read this once)

- **Supabase side.** After you enable custom SMTP, Supabase applies its own email rate limit to the project. The default is low (about 30 emails per hour). Open **Authentication -> Rate Limits** and look at "Rate limit for sending emails"; raise it there if you ever expect more.
- **Resend side.** The Resend free tier is limited (about 100 emails per day and 3,000 per month). Auth emails share that budget with order emails, status emails and contact messages. You stay on the free tier: if you get close to the limit, do not upgrade; tell us and we will look at it together.
- The numbers above are from the docs as last known. Check the actual numbers in both dashboards (Supabase **Authentication -> Rate Limits**, Resend **Settings -> Usage / Plans**) before relying on them.

---

## Part 2. Redirect URLs (check once)

The links in the emails only work if Supabase knows the site's address. This is the same setting described in `docs/LIVE_RETEST.md` ("Before re-testing: Supabase redirect URLs"). Check **Authentication -> URL Configuration**:

- **Site URL**: `https://gestaltung360.com`
- **Redirect URLs** include: `https://gestaltung360.com/**`, `https://www.gestaltung360.com/**`, `http://localhost:3000/**` (and the `/api/auth/callback` entries listed in `LIVE_RETEST.md`).

---

## Part 3. Branded templates (the text)

Open **Authentication -> Emails -> Templates** (labelled "Email Templates" in some versions). For each row below: open that template, set the **Subject** to the line given, open the file from this repo, copy the whole file, paste it into the **Message body** (HTML source), and **Save**.

| Supabase template | File | Subject (one line, EN + AR) |
|-------------------|------|------------------------------|
| Confirm signup | `supabase/auth-templates/confirm-signup.html` | `Confirm your email · تأكيد بريدك الإلكتروني — Gestaltung` |
| Reset password | `supabase/auth-templates/reset-password.html` | `Reset your password · إعادة تعيين كلمة المرور — Gestaltung` |
| Magic Link | `supabase/auth-templates/magic-link.html` | `Your sign-in link · رابط تسجيل الدخول — Gestaltung` |
| Change Email Address | `supabase/auth-templates/change-email.html` | `Confirm your new email · تأكيد بريدك الجديد — Gestaltung` |

Leave the other templates (Invite user, Reauthentication) as they are; the app does not use them.

Each template is plain email HTML (tables, inline styles, no images, no web fonts, no scripts): English block first, then Arabic block, one button in each block (both point to the same link), a plain-text link under the button, and the footer "Gestaltung · Lusail, Qatar". Keep the `{{ ... }}` placeholders exactly as they are; Supabase fills them in.

### Which link the templates use, and why

All four templates use `{{ .ConfirmationURL }}`. This is right for this app because of how it consumes the links:

- **Reset password.** `components/auth/forgot-password-form.tsx` calls `resetPasswordForEmail` with `redirectTo = {origin}/api/auth/callback?next=/{locale}/reset-password`. `{{ .ConfirmationURL }}` is Supabase's own verify link; once it has checked the token it sends the visitor on to that `redirectTo` with a `code`. `app/api/auth/callback/route.ts` swaps the `code` for a session cookie (it also accepts `token_hash` + `type`) and forwards to the reset page, in the language the visitor was using. A hand-built `token_hash` link would lose that per-visitor `redirectTo`, so it is not used.
- **Confirm signup.** `components/auth/sign-up-form.tsx` sets no `emailRedirectTo`, so after confirming, the visitor lands on the **Site URL** (Part 2). That is why Site URL must be `https://gestaltung360.com`.
- **Magic Link.** The app does not use magic links today; the template is ready in case it does.
- **Change Email Address.** Also used when a guest account adds its first email (the sign-up form upgrades the guest with `updateUser`). In that case the account has no current email, so the template hides the "current email" line automatically.
- One known limit of this form: the app signs in with PKCE, so the link must be opened in the **same browser** that asked for it. If a visitor opens it on another device, they land on the expiry message and can request a new link. If that proves to be a real problem, the callback route already accepts `token_hash`, and the templates can be switched to `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/en/reset-password` (type `signup`, `magiclink` or `email_change` for the others). Do not do this unless it is needed: it fixes the next path to one language.

---

## Part 4. Test (about 5 minutes, sends real emails)

Use a fresh address you can read (a `+` alias such as `you+authtest@gmail.com` works), in a private window.

1. **Sign up.** Open https://gestaltung360.com/en/sign-up and create an account with the fresh address. An email arrives. Check: the sender shows **Gestaltung** (not Supabase) from `noreply@contact.gestaltung360.com`, the subject is the bilingual one, the English block is above the Arabic block, and the Arabic reads right-to-left. Click **Confirm email**; you must end up on gestaltung360.com (not a `supabase.co` page).
2. **Password reset.** Open https://gestaltung360.com/en/forgot-password and enter the same address. Check the same things. Click **Choose a new password**: the address bar must pass through `gestaltung360.com/api/auth/callback` and land on `/en/reset-password`. Set a new password and sign in.
3. **Second click.** Click the same reset link again: you must land on `/en/forgot-password?expired=1`.
4. **Arabic page.** Repeat step 2 from `/ar/forgot-password`; you must land on `/ar/reset-password`.
5. **Guest upgrade (change email template).** In a private window, start a project as a guest, then sign up with a new address. The confirmation email uses the Change Email Address template; check that it renders and its button works.
6. Open the emails on a phone too (Gmail app). If a mail lands in spam, mark "not spam" once and report it.

If anything fails, note the step and what you saw and send it back.

---

## Rollback

To go back to the old Supabase sender: **Project Settings -> Authentication -> SMTP Settings** -> turn **Enable custom SMTP** off -> **Save**. Emails go back to Supabase's built-in sender immediately. To go back to the default text for a template, open it under **Authentication -> Emails -> Templates** and paste Supabase's default body back (or use its reset-to-default option if your dashboard shows one). The app itself is unaffected either way.
