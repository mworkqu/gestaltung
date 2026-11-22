# Chat plugin — Phase 4: ChatGPT done, sign-in and cart not built (2026-11-22)

Branch `plugin-phases`, on top of Phase 3. **4c is done. 4a (OAuth) and 4b
(cart) are deliberately not built** — this file says why and exactly what to do
next, so the decision is the owner's rather than a guess of mine.

## 4c — ChatGPT (done)

Most of it was already true from Phase 1: the endpoint is stateless Streamable
HTTP with no cookies, and `sourceFromName()` reads the MCP client info and
records `chatgpt` on a hand-off. What this phase added:

- Migration **0114** (NOT RUN): `meeting_bookings.chat_source`
  ('claude' | 'chatgpt' | 'other', null = booked from the website) and
  `book_meeting` with `p_chat_source` appended, replacing 0113's 12-argument
  signature so PostgREST has no overload to choose between. An unknown chat
  name is stored as null, never refused — a new host can't fail a booking.
- The tool passes which chat is calling; Dashboard → Sell → Meetings tags the
  row "From ChatGPT" or "From Claude".
- `docs/CHATGPT_SUBMISSION.md`: the tool-by-tool audit against OpenAI's rules
  (writes, annotations, confirmations, personal data per tool), the Developer
  Mode steps and the reviewer prompts.

The preview card already carried `openai/outputTemplate` from Phase 3, so one
server serves both hosts.

## 4a — not built, but smaller than this file first said

**Correction (2026-11-22).** An earlier version of this file said Supabase Auth
cannot be the identity provider and that we would have to write an OAuth 2.1
authorization server ourselves. That is out of date. Supabase shipped **OAuth
2.1 server capabilities** in Auth: it serves the authorization and token
endpoints, RFC 8414 discovery and JWKS, and it supports Dynamic Client
Registration, which is how Claude and ChatGPT register themselves. It is in
**beta, on all plans, with no separate charge**, so it breaks no rule about paid
services. The design below is rewritten accordingly; there is no migration
0115 and there are no `oauth_*` tables of ours.

What stays true: the MCP server is a **resource server**, not an authorization
server. Our `/api/mcp` route must publish RFC 9728 protected-resource metadata,
answer 401 with a `WWW-Authenticate` challenge on a scope-requiring tool, and
validate the bearer token it is given — including that the token was issued for
us. That part is ours either way.

### The design, if the owner says go

Supabase side (dashboard, the owner's to do, no code):

- Authentication → **OAuth Server**: enable OAuth 2.1 server capabilities, set
  the Authorization Path to `/oauth/consent`, and decide whether to allow
  dynamic registration. The docs warn that dynamic registration lets **any** MCP
  client register with the project; the alternative is to register Claude and
  ChatGPT by hand under Authentication → OAuth Apps.
- **JWT Signing Keys**: the project must sign with an asymmetric key (ES256 or
  RS256). A project still on the legacy shared secret has to be switched first,
  and that switch affects every existing token, so it is not a side effect to
  take lightly — it wants its own small stage.
- The issuer stays on the project host
  (`https://<ref>.supabase.co/auth/v1`) even behind our custom domain.

Our side (code):

- `GET /.well-known/oauth-protected-resource` and the path-scoped
  `/.well-known/oauth-protected-resource/api/mcp` → `{ resource:
  "https://gestaltung360.com/api/mcp", authorization_servers:
  ["https://<ref>.supabase.co/auth/v1"], bearer_methods_supported: ["header"],
  resource_documentation: ".../legal/privacy" }`.
- A **consent page** at `/[locale]/oauth/consent`, EN + AR, in our design. This
  is the only real UI: Supabase hands it an `authorization_id`; it requires a
  real (non-guest) Supabase sign-in, calls `getAuthorizationDetails`, shows the
  client name and what is being asked for in plain words, and on the person's
  decision calls `approveAuthorization` or `denyAuthorization` and redirects to
  the `redirect_url` it gets back.
- **Token validation** in the MCP route: verify the JWT against the project
  JWKS (asymmetric only — reject HS256), check it is not expired, and read
  `user_id` and `client_id`. Unauthenticated calls stay **allowed**: everything
  in Phases 1–3 must keep working without an account, and only a
  scope-requiring tool answers 401.
- Signed in, the behaviour the brief asks for: `send_project` creates the
  project in the person's account with no claim step, and `book_meeting` fills
  the contact details from the profile.

### The three things to check before building, not during

The docs I read do not answer these, and each one changes the code:

1. **Audience binding.** The spec requires a resource server to refuse a token
   that was not issued for it. Supabase's access tokens are "standard Supabase
   JWTs" carrying `user_id`, `role` and `client_id`; RFC 8707 resource
   indicators are not mentioned, and setting `aud` is described as a job for a
   **Custom Access Token Hook**. So the check has to be built deliberately — on
   `aud` via a hook, or failing that on `client_id` against the clients we
   recognise. Skipping it is the token-passthrough mistake the spec names.
2. **Scopes.** Only `openid`, `email`, `profile` and `phone` are documented.
   Custom scopes such as `cart:write` may not exist, in which case authorisation
   is per-client, not per-scope, and the consent page's wording has to be honest
   about that rather than listing scopes we cannot enforce.
3. **PKCE S256 and MAU.** PKCE is mandatory in their flow but the method is not
   stated; and people who sign in through the OAuth server count toward the
   project's monthly active users, which matters on the Free plan.

A short spike — enable it on the project, point Claude at our server, watch one
real token arrive and print its claims — settles all three in an hour and is
worth doing before any of the above is written.

## 4b — the cart tool (not built, depends on 4a)

`add_parts_to_cart` must be signed-in only, so it waits for 4a. When it lands,
the one thing that must not be got wrong: it has to use the Studio's **atomic**
`addKit` / `kitPlan` insert (one insert, all or nothing) and never add lines in
a loop. That loop is the P5-02 failure mode and it has already come back once
as F-006 (see `docs/audit/FIX_REPORT.md`). No order placement from the chat:
checkout stays on the website.

## Checks

typecheck, lint (0 errors, ratchet holds), the full unit suite, i18n parity and
`npm run build` all pass with 4c in place.

## Not verified

- Migrations 0113 and 0114 are both NOT RUN.
- Nothing has been submitted to either directory, and the server has never been
  added as a ChatGPT connector, so the ChatGPT render of the preview card is
  untested.
- 4a and 4b do not exist, so there is nothing to test for them.
