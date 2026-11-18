# CAD Champions auth emails (owner action)

CAD Champions (CC) sends three auth emails through Supabase: **confirm sign-up**, **magic link** (the "Email me a sign-in link" button) and **reset password**. The bilingual CC versions (Arabic first, then English, one button, Gestaltung colours) are in:

- `supabase/auth-templates-cc/confirm-signup.html`
- `supabase/auth-templates-cc/magic-link.html`
- `supabase/auth-templates-cc/reset-password.html`

Each file's first comment line holds the subject line.

## The catch: one template per project

Supabase has **one** template per email type for the whole project. The main site (gestaltung360.com) and CAD Champions share the same Supabase project, so they also share these emails. Pick one:

- **(a) Recommended: make the project-wide templates serve both.** Supabase templates can branch on the user's sign-up data (`.Data` = user metadata). Every CC sign-up stores its answers under `cc`, so this works in all three templates:

  ```
  {{ if .Data.cc }}
    ...paste the <body> of the CC file here...
  {{ else }}
    ...paste the <body> of the site file (supabase/auth-templates/<same name>.html) here...
  {{ end }}
  ```

  Put the shared `<head>` once above it. CC users get the CC email, site users keep today's site email. Subject lines cannot branch, so use a neutral one, for example: `تأكيد بريدك الإلكتروني · Confirm your email`.
  Note: a main-site user who later joins CC without signing up again (the "complete your CC profile" path) has no `cc` data and keeps getting the site email. That is fine.

- **(b) Keep the site's templates.** Nothing to do. CC users then get the site's Gestaltung email (English first, then Arabic). Links still work, because they go through the same callback.

## Where to paste (both options)

Supabase dashboard -> the Gestaltung project -> **Authentication -> Emails -> Templates**:
- "Confirm signup" -> confirm-signup
- "Magic Link" -> magic-link
- "Reset Password" -> reset-password

Sender settings (SMTP) are already described in `docs/AUTH_EMAILS.md`; nothing changes there.

## Redirect URLs (check once)

All CC email links go through the site's existing callback: `https://<site>/api/auth/callback?next=/cad-champions/<en|ar>/…`. Supabase must allow it. In **Authentication -> URL Configuration -> Redirect URLs** these entries must exist (they are the same ones `docs/LIVE_RETEST.md` asks for):

- `https://gestaltung360.com/**`
- `https://www.gestaltung360.com/**`
- `http://localhost:3000/**`

If only the exact `/api/auth/callback` entries are there (without `**`), add the `**` forms: the CC links carry a `?next=` query.

## What happens after the link (for testing)

| Email | Link goes to | Then |
|---|---|---|
| Confirm sign-up | `/api/auth/callback` | `/cad-champions/{locale}/auth/continue` creates the CC profile from the sign-up answers, sets the language from the profile, opens the dashboard (or the page they wanted) |
| Magic link | `/api/auth/callback` | same `auth/continue` step |
| Reset password | `/api/auth/callback` | `/cad-champions/{locale}/reset-password` (choose a new password) |
| Any expired / used link | `/api/auth/callback` | CC sign-in (or CC forgot-password for a reset link) with an "expired" note |

Links must be opened in the same browser they were requested from (Supabase PKCE).

## Owner checklist
1. Choose (a) or (b). For (a), paste the three combined templates and the neutral subjects.
2. Check the Redirect URLs above.
3. Test: sign up on `/cad-champions/ar/sign-up` with a real address -> confirm email arrives -> link opens the CC dashboard in Arabic.
