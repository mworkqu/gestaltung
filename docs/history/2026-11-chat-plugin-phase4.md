# Chat plugin — Phase 4: ChatGPT, sign-in and the cart (2026-11-23)

Branch `plugin-phases`, on top of Phase 3. All of Phase 4 is built: **4a**
(sign-in through OAuth), **4b** (the cart tool) and **4c** (ChatGPT).

One correction to record, because an earlier version of this file said the
opposite: it claimed Supabase Auth could not be the identity provider and that
we would have to write an OAuth 2.1 authorization server ourselves. That was out
of date. Supabase shipped **OAuth 2.1 server capabilities** — authorize and
token endpoints, RFC 8414 discovery, JWKS and dynamic client registration — in
**beta, on all plans, with no separate charge**. So no authorization server of
ours exists, there is no `oauth_clients` / `oauth_codes` / `oauth_tokens` table,
and 4a came down to a consent page plus token validation.

## What the owner has to do before any of 4a works

Nothing below changes behaviour until these two are done, and nothing breaks
while they are not: with the OAuth server off, no access token ever arrives and
every tool behaves exactly as it did in Phase 3.

1. **Supabase → Authentication → OAuth Server**: switch on the OAuth 2.1 server,
   set the Authorization Path to `/oauth/consent`, and decide about dynamic
   client registration. Supabase's own warning is worth repeating: dynamic
   registration lets **any** MCP client register with the project. The
   alternative is to register Claude and ChatGPT by hand under Authentication →
   OAuth Apps, which is the tighter choice and costs one form each.
2. **Supabase → JWT Signing Keys**: the project must sign with an asymmetric key
   (ES256 or RS256). Verification is then local against the cached JWKS, with no
   round trip per call. A project still on the legacy shared secret has to be
   switched, and that switch affects every existing token, so do it on its own
   and watch the site afterwards — not in the same sitting as everything else.
3. Run migration **0115** (and 0113 / 0114, still pending) in the SQL editor.

## 4a — sign-in (built)

We are the **resource server**; Supabase is the authorization server. That split
is the whole design.

| Ours | File |
|---|---|
| The rules: issuer, audience, scopes, `checkTokenClaims` | `lib/plugin/oauth.ts` (pure, 14 unit tests) |
| Verification and acting as the person | `lib/plugin/server/oauth.ts` |
| RFC 9728 metadata | `lib/plugin/server/resource-metadata.ts` + `app/.well-known/oauth-protected-resource` and `…/api/mcp` |
| The one screen Supabase does not host | `app/[locale]/oauth/consent/{page.tsx,actions.ts}` |
| The gate | `app/api/mcp/route.ts` — `withMcpAuth(…, { required: false })` |

Four decisions in it that are not obvious:

- **`required: false`.** Everything from Phases 1-3 keeps working with no
  account. A token only ever ADDS what an account allows.
- **But an unacceptable token is refused, not downgraded.** The verifier returns
  `undefined` only when there is NO token; a token that fails any check throws,
  which `withMcpAuth` turns into 401 with
  `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="…"`. That
  is how a host knows to authorize again. The first version of this code
  silently treated a bad token as anonymous, which hid an expired token behind a
  confusing tool refusal; the e2e test `an unusable bearer token is refused, not
  quietly treated as anonymous` exists so that cannot come back.
- **`client_id` is the audience check, for now.** The spec requires a resource
  server to refuse a token that was not issued for it. Supabase's access tokens
  carry the fixed `aud: "authenticated"` unless a Custom Access Token Hook sets
  otherwise, and RFC 8707 resource indicators are not documented. So: if `aud`
  names a URL, it MUST be our MCP URI; otherwise we require a `client_id` claim,
  which only the OAuth server issues. The effect is that a token from an
  ordinary sign-in on our own website — or a stolen session — cannot act through
  a chat. If a hook later sets `aud`, `audienceAllowed()` enforces it with no
  code change.
- **Scopes are honest about what Supabase documents.** Only
  openid / email / profile / phone are documented, and it is not documented
  whether a custom scope survives into the access token. So a token naming any
  of ours is taken at its word (least privilege), and a token naming none gets
  all three — because then the person's consent was per CLIENT, which is exactly
  what the consent page says. `scopesFromClaims()` flips to least privilege the
  moment custom scopes do come through.

The consent page shows who is asking, the redirect host, the account e-mail, the
three things it would be allowed to do in plain words, and the line that matters
most: **it cannot place an order, pay anything, or see your password**. It
refuses a guest (anonymous) session, because a guest cannot be signed into again
and a token minted for one would die with the browser. It is `noindex`, has no
client component (so no i18n scope entry), and works without JavaScript.

## 4b — the cart (built)

Tool `add_parts_to_cart`: signed in, scope `cart:write`, its own daily rate
bucket (20 per hashed IP), SKUs from `search_parts` / `check_project`.

The thing that must not be got wrong is the write, and it is the reason for
migration **0115**: `plugin_add_to_cart(p_lines jsonb)` writes every line in
**one statement**, topping up a product already in the cart through the 0025
unique index. Never a line-at-a-time loop — that is the P5-02 failure mode that
already came back once as F-006. It is `authenticated`-only and the caller IS
the user (`auth.uid()` from their own token), so the service client is not
involved and ownership is the database's business, not ours. It never raises;
every refusal is `{ok:false, reason:…}` so the tool can turn it into words.

It also lifts a quantity to the product's `min_order_qty`, caps a call at 20
products and a line at 999, and returns in `skipped` any SKU it could not add
(unpublished, merged, or not deliverable) instead of dropping it quietly.

**Nothing is ordered from a chat.** The tool answers with the cart link and the
line "delivery and the binding total are shown at checkout on the website".
`create_part_order` and every total are untouched.

Two smaller things the brief asked for, now true when signed in:

- `send_project` claims the hand-off straight into the account, so there is no
  claim page and the link is the project itself. If the claim fails for any
  reason it falls back to the 30-day hand-off link, which is why the hand-off row
  is still written first.
- `book_meeting` fills the name, phone and e-mail from the profile when the chat
  did not repeat them. What the user says in the chat always wins.

## 4c — ChatGPT (built, as before)

Migration 0114 records which chat booked a meeting (`chat_source`), hand-offs
already did (0112), and `docs/CHATGPT_SUBMISSION.md` holds the tool-by-tool
audit against OpenAI's rules. The preview card carries both
`_meta.ui.resourceUri` and ChatGPT's `openai/outputTemplate`, so one server
serves both hosts.

## Checks

- typecheck, `npm run lint` (0 errors, ratchet holds at 303), `npm test`
  (5,426 tests in 433 files), i18n parity (5,409 keys each), `db:types:check`,
  `npm run build`, `npm run worker:build`, `check:cycles`, legal `--check`.
- `lib/db-test/plugin-cart-migration.test.ts`: 9 PGlite tests over 0115, applied
  twice — who may call it, the quantity rules, the top-up instead of a duplicate,
  a repeated SKU summed in one call, the caps, and that a refusal writes nothing.
- `lib/plugin/oauth.test.ts`: 14 tests over the claim rules.
- `lib/plugin/server/register.test.ts`: 40 tests, including the 13 new ones for
  the connected account (the cart's happy path, no token, a token without the
  scope, each database refusal, the project straight into the account, the
  fallback, the booking prefill and that an anonymous booking reads no account).
- `e2e/oauth-consent.spec.ts`: 20 Playwright tests — the consent page's two
  signed-out states in EN and AR at 375 px and 1366 px, the metadata document at
  both paths, anonymous MCP access still 200, and the 401 challenge.
- Verified by hand against the production build: the metadata document at both
  paths, a bogus bearer token answered 401 with the challenge header, an
  anonymous `tools/list` answered 200 with all eight tools, and the consent page
  in both locales (its sign-in link round-trips the `authorization_id`).

## Not verified

- **The whole signed-in path end to end.** It needs the OAuth server switched on
  in the owner's project and an asymmetric signing key, which is the owner's
  dashboard work. Everything up to the token — metadata, the challenge, the
  consent screen's states — is verified; the approve → code → token → tool call
  round trip is not, and cannot be from here.
- Migrations 0113, 0114 and 0115 are all NOT RUN.
- `getClaims()` was not exercised against a real Supabase OAuth token, so the
  exact claim set (whether `client_id` is really there, whether a custom scope
  survives) is as documented, not as observed. `lib/plugin/oauth.ts` is written
  so that either answer is handled, and the first real token will settle it —
  the server logs `[mcp] token refused: <reason>` on every refusal, which is the
  fastest way to see what arrived.
- Nothing has been submitted to either directory.
