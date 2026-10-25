# Auth emails: from Gestaltung, not Supabase

The confirm-signup, password-reset, change-email and magic-link emails are sent through **Resend** (the account that already sends the order and contact emails) with branded English + Arabic templates in `supabase/auth-templates/`.

**2026-10 change:** the links no longer go through Supabase's verify URL. They point at our own site, carry the token hash, and every email also prints a 6-digit code. See "Why the link changed" below before touching this.

The dashboard steps below cannot be scripted. Both dashboards are free; nothing here needs a paid plan. Time: about 20 minutes.

---

## What you need

- Supabase dashboard access to the Gestaltung project.
- The Resend API key already set in Vercel (as `RESEND_API_KEY`). If you no longer have the value, create a new key in Resend with "Sending access" for `contact.gestaltung360.com` and update Vercel too. Never paste the key in a chat or document; paste it only into the Supabase password field.
- The Resend domain `contact.gestaltung360.com` is already verified; no DNS work.
- The app-side pages that receive the new links (`/{locale}/reset-password` and `/{locale}/confirm-email`, verifying only when the form is submitted) must be deployed before you paste the templates. If you paste the templates first, new emails will link to pages that cannot verify the token.

---

## Owner checklist (do in this order)

1. **Templates and subjects.** Supabase dashboard -> **Authentication -> Emails** (Templates). For each row open the template, set the **Subject**, paste the whole file into **Message body** (HTML source), **Save**:

   | Supabase template | File | Subject (EN + AR, one line) |
   |-------------------|------|------------------------------|
   | Reset password | `supabase/auth-templates/reset-password.html` | `Reset your password · إعادة تعيين كلمة المرور — Gestaltung` |
   | Confirm signup | `supabase/auth-templates/confirm-signup.html` | `Confirm your email · تأكيد بريدك الإلكتروني — Gestaltung` |
   | Change Email Address | `supabase/auth-templates/change-email.html` | `Confirm your new email · تأكيد بريدك الجديد — Gestaltung` |
   | Magic Link | `supabase/auth-templates/magic-link.html` | `Your sign-in link · رابط تسجيل الدخول — Gestaltung` |

   Leave Invite user and Reauthentication as they are (the app does not use them). Keep every `{{ ... }}` placeholder exactly as written.

2. **Redirect URLs.** **Authentication -> URL Configuration**. Site URL stays `https://gestaltung360.com`. Under Redirect URLs add all twelve:
   - `https://gestaltung360.com/en/reset-password`, `https://gestaltung360.com/ar/reset-password`, `https://gestaltung360.com/en/confirm-email`, `https://gestaltung360.com/ar/confirm-email`
   - the same four on `https://www.gestaltung360.com`
   - the same four on `http://localhost:3000`

   Keep the existing `/api/auth/callback` entries (and the `/**` entries from `docs/LIVE_RETEST.md`): social sign-in still uses them. If a redirect URL is missing, Supabase replaces `{{ .RedirectTo }}` with the Site URL and the link lands on the wrong page.

3. **OTP expiration = 3 hours.** **Authentication -> Email** (in some versions **Providers -> Email**): set **Email OTP expiration** to **10800 seconds (3 hours)**. Why: university and corporate mail gateways (for example `qu.edu.qa`) can hold external mail for many minutes before delivering it, and the old default left too little time. The link and the code in the emails both say "valid for 3 hours"; this setting is what makes that sentence true. If you change the value later, change the sentence in all four templates too.

4. **Custom SMTP is Resend.** **Project Settings -> Authentication -> SMTP Settings** (or Authentication -> Emails -> SMTP Settings): Enable custom SMTP with

   | Field | Value |
   |-------|-------|
   | Sender email | `noreply@contact.gestaltung360.com` |
   | Sender name | `Gestaltung` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the Resend API key already set in Vercel |

   Then **Authentication -> Rate Limits**: "Rate limit for sending emails" must be **at least 30 per hour**. Resend's free tier (about 100 emails/day, 3,000/month) is shared with order and contact emails; check the real numbers in Resend -> Settings -> Usage. Stay on the free tier.

5. **Record the CAPTCHA state.** **Authentication -> Attack Protection**: write down whether CAPTCHA is on or off and which provider (Turnstile / hCaptcha). This change does not alter it; we only need to know. (If it is on, `docs/TURNSTILE.md` rules apply to sign-in forms.)

Then run the test below.

---

## What each email contains

One card, English first then Arabic (right-to-left, Western digits): brand header, heading, one line of what to do, ONE button, the 6-digit code in a large box ("or enter this code"), the same link as plain text ("or copy this link"), and "This link and code are valid for 3 hours." Footer: Gestaltung for Trading and Services W.L.L, C.R. 236988, Lusail, Qatar, https://gestaltung360.com.

| Template | Link (the button and the plain-text link) |
|----------|---------------------------------------------|
| Reset password | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery` |
| Confirm signup | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup` |
| Change email | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email_change` |
| Magic link | `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` |

The app always passes a locale path as `redirectTo` / `emailRedirectTo` (for example `https://gestaltung360.com/en/reset-password`), so `{{ .RedirectTo }}` is already in the visitor's language. The templates never add a locale. The code is `{{ .Token }}`. The change-email template hides the "current email" line when the account has no email yet (a guest adding its first one).

Preview the templates as images: `node scripts/render-auth-emails.mjs` writes 600 px and 360 px PNGs to `review/fixes/emails/` (needs a local Chrome or Edge; `CHROME_PATH` overrides).

---

## Why the link changed (do not revert)

The old templates used `{{ .ConfirmationURL }}`, a Supabase `.../auth/v1/verify?token=...` link that is single-use and is consumed by the first request that opens it. University and corporate mail security (Microsoft 365 Safe Links, Mimecast, Proofpoint) opens every link in an incoming message to scan it, so the token was already spent before the person clicked: the reset arrived "already expired". It also used PKCE, whose secret lives in the browser that asked for the reset, so opening the email on a phone or another browser failed. The new link points at our own page and carries only the token hash; the page does nothing on load and verifies only when the person presses the button (a scanner does not submit forms). The 6-digit code is the fallback: a scanner cannot spend a code, and it works in any browser. Do not switch back to `{{ .ConfirmationURL }}`.

---

## Test (about 5 minutes, sends real emails)

Use a fresh address you can read (a `+` alias works), in a private window. Also try once with a `qu.edu.qa` address if you have one.

1. **Sign up** at https://gestaltung360.com/en/sign-up. Check: sender is **Gestaltung** from `noreply@contact.gestaltung360.com`, bilingual subject, English above Arabic, Arabic right-to-left, code visible. Click **Confirm email**: you land on our `/en/confirm-email` page; press its button; you end up signed in on gestaltung360.com, never on a `supabase.co` page.
2. **Password reset** from `/en/forgot-password`. Click the button: our reset page opens and shows the form; set a new password and sign in.
3. **Other device.** Request a reset on a computer, open the email on a phone. It must work (no same-browser requirement now).
4. **Scanner simulation.** Open the reset link, close the tab without submitting, open the same link again: it must still work. Then try the 6-digit code instead on the page.
5. **Arabic**: repeat step 2 from `/ar/forgot-password`; you must land on `/ar/reset-password`.
6. **Guest upgrade (change email template).** Start a project as a guest, then sign up with a new address; the confirmation email uses the Change Email Address template.
7. Open the emails on a phone too. If one lands in spam, mark "not spam" once and report it.

If anything fails, note the step and what you saw.

---

## Reading delivery latency in Resend

To see how long a message to a `qu.edu.qa` address really took:

1. Resend dashboard -> **Emails**. In the search/filter box type the recipient address (or `qu.edu.qa` to see all of them) and, if offered, filter Status = Delivered.
2. Open the message. Compare the timestamps: **Sent / Queued** (when Resend accepted the message from Supabase) and **Delivered** (when the recipient's mail server accepted it). The events list on the message page shows each with a time.
3. Delivered minus Sent is the delivery delay. A few seconds is normal. If it is minutes, the delay is at the recipient's gateway (greylisting or scanning at the university), not in our system: Supabase handed it to Resend immediately and Resend handed it on. A status of "Delivery delayed" means the receiving server asked Resend to retry later. This is exactly why the code and link now last 3 hours.
4. If Sent itself is late compared with when the user pressed the button, check the Supabase email rate limit (checklist step 4) instead.

---

## Rollback

To go back to Supabase's own sender: **SMTP Settings** -> turn Enable custom SMTP off -> Save. To go back to default template text, paste Supabase's default body back. Rolling the templates back to `{{ .ConfirmationURL }}` re-introduces the scanner problem and needs the old callback route (`/api/auth/callback`, still deployed for social sign-in).
