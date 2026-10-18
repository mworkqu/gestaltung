# Sign in with Google, Microsoft or Apple

**State on 18 Oct 2026** (set up the same day):

| Setting | Now |
| --- | --- |
| Email sign-in | on |
| Guest (anonymous) sessions | on |
| Allow manual linking | on |
| **Google** | **on** - consent screen External / In production, OAuth client "Gestaltung sign-in" in Google Cloud project dazzling-card-506200-g5 (client id ends `...72uvpii5`), redirect URI `https://jgwuafubtmpaonsznfyw.supabase.co/auth/v1/callback`. The button is live on /en/sign-in and /ar/sign-in. |
| Microsoft / Apple | off - optional; Apple costs USD 99/year |
| Prevent use of leaked passwords | off - **Pro plan only**, not available on the free plan |

Instead of leaked-password protection, the free plan can still raise
**Authentication -> Sign In / Providers -> Email -> Minimum password length** from 6 to 10 and
set **Password requirements** to letters + digits + symbols.

Google note: the consent screen is shared with the Drive picker and the YouTube connection in the same
Cloud project. It has no sensitive scopes, so no Google verification was needed; if a sensitive scope is
added later, Google will ask for verification before new users can consent.

The buttons "Continue with Google / Apple / Microsoft" are already in the code on /sign-in and /sign-up.
Each button appears **by itself** within 5 minutes of you turning that provider on in Supabase (no deploy).
Google is on; Microsoft and Apple are not, so only the Google button shows today.

**Paste this callback URL everywhere a "redirect URI" is asked for:**

```
https://jgwuafubtmpaonsznfyw.supabase.co/auth/v1/callback
```

Do these once, in this order:

## 1. Supabase: let guests keep their work

Supabase → **Authentication → Sign In / Providers** (settings at the top) → turn on **Allow manual linking** → Save.

Why: a guest who started a project and then presses "Continue with Google" becomes a real account with the same
projects, cart and credits. Without this switch they are signed in too and the site moves their work over,
but linking keeps everything in one place.

Also check **Authentication → URL Configuration**: Site URL `https://gestaltung360.com`, Redirect URLs include
`https://gestaltung360.com/**`, `https://www.gestaltung360.com/**`, `http://localhost:3000/**`
(the same list as in `docs/AUTH_EMAILS.md`). The social buttons return to `/api/auth/callback`, which these cover.

## 2. Google (free)

You already have the Google Cloud project **dazzling-card-506200-g5** (the Drive picker uses it). Its consent
screen is **Internal** (only gestaltung360.com accounts). Public sign-in needs **External**.

1. console.cloud.google.com → project dazzling-card-506200-g5 → **Google Auth Platform → Audience** →
   User type **External** → **Publish app** (status "In production").
   - Note: this project's consent screen is shared with the Drive picker and the YouTube connection. If you
     would rather not touch it, create a new project "Gestaltung sign-in" and do steps 1–3 there instead.
2. **Branding**: App name `Gestaltung`, support email `info@gestaltung360.com`, logo optional,
   privacy policy `https://gestaltung360.com/en/privacy`, terms `https://gestaltung360.com/en/terms`,
   authorised domain `gestaltung360.com`.
3. **Data access**: scopes `openid`, `email`, `profile` only. These need no Google review.
4. **Clients → Create client** → type **Web application**, name `Gestaltung sign-in`
   (a new client; leave the Drive picker client alone) → Authorised redirect URI = the Supabase callback above → Create.
   Copy the **Client ID** and **Client secret**.
5. Supabase → **Authentication → Sign In / Providers → Google** → Enable → paste Client ID and Client secret → Save.

## 3. Microsoft (free)

1. portal.azure.com → **Microsoft Entra ID → App registrations → New registration**.
   - Name `Gestaltung sign-in`.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI: platform **Web**, the Supabase callback above → Register.
2. Copy the **Application (client) ID**.
3. **Certificates & secrets → New client secret** → pick the longest expiry → copy the **Value** now (it is shown once).
   **Write down the expiry date.** When it expires, Microsoft sign-in stops: make a new secret and paste it in Supabase.
4. **Token configuration → Add optional claim → ID** → tick `email` and `xms_edov` → Add.
   Without `xms_edov` Supabase may treat Microsoft emails as not confirmed, and those users would be limited like guests in the AI steps.
5. Supabase → **Authentication → Sign In / Providers → Azure** → Enable → Client ID, Secret Value,
   Azure Tenant URL `https://login.microsoftonline.com/common` → Save.

## 4. Apple (paid, optional)

**Apple sign-in needs the Apple Developer Program: USD 99 per year, a paid subscription.** Skip this section
unless you decide to pay for it. Google and Microsoft work without it.

If you do:
1. developer.apple.com → Certificates, IDs & Profiles → **Identifiers**: an App ID with "Sign in with Apple", then a
   **Services ID** (e.g. `com.gestaltung360.signin`) → Configure: domain `jgwuafubtmpaonsznfyw.supabase.co`,
   return URL = the Supabase callback.
2. **Keys** → new key with "Sign in with Apple" → download the `.p8` file (once only). Note the Key ID and your Team ID.
3. Make the client secret (a signed JWT) from Team ID + Key ID + Services ID + `.p8` — Supabase's Apple page links a
   generator. **It expires after 6 months**: put a reminder to make a new one.
4. Supabase → **Authentication → Sign In / Providers → Apple** → Enable → Client ID = the Services ID, Secret = the JWT → Save.

Apple may share no name and a private relay email (…@privaterelay.appleid.com). That is fine: the account still works;
the name can be added later and the "Get it made" form asks for missing details.

## 5. Test (5 minutes after saving a provider)

1. Private window → https://gestaltung360.com/en/sign-in → the new button shows above the email form.
2. Press it → choose your account → you land on the dashboard. Repeat on /ar/sign-in (Arabic label).
3. Guest test: private window → "Plan a product" → type an idea → Start (a guest project) → Sign in →
   Continue with Google → the project is still in **My projects**.
4. Same guest test with a Google account that already has a Gestaltung account → you are signed in to that account
   and the guest project moves into it.
5. Press the button and cancel on Google's page → back on sign-in with "Sign-in with Google didn't work. Try again or use your email."

## Notes

- Bot check (Turnstile): social sign-in goes through Google/Microsoft/Apple's own pages. Supabase's CAPTCHA setting does
  not apply to it (it covers email sign-in, sign-up, password reset and guest sessions), so nothing extra to set.
- Run migration `0076_social_sign_in_profiles.sql` (fills the profile name from Microsoft/Google and for guests who link).
  Sign-in works before it runs; profiles are just created without a name in some cases.
- Turning a provider off in Supabase removes its button within 5 minutes.
