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

## 4a — why OAuth is not built

The brief says "Supabase Auth is the identity provider … OAuth is the only way
to know the user". The first half does not work as written, and that changes
the size of the job:

**The MCP server is a resource server, not an authorization server.** The spec
(2026-07-28, and 2025-11-25 before it) requires the MCP server to serve RFC
9728 protected-resource metadata and to validate audience-bound bearer tokens.
The RFC 8414 authorization-server metadata, the `/authorize` endpoint, the
`/token` endpoint and client registration all belong to an **authorization
server**, which is a separate thing.

**Supabase Auth is not one.** It signs users into *our* app. It does not issue
OAuth access tokens to third-party clients, has no authorization endpoint for
them, cannot bind a token's audience to our MCP URI (RFC 8707 `resource`), and
offers neither Dynamic Client Registration nor Client ID Metadata Documents —
all of which Claude and ChatGPT use to register themselves. So "use Supabase
Auth as the IdP" can only mean: Supabase signs the person in on our consent
page, and **we** issue the MCP token. That is us writing an OAuth 2.1
authorization server.

### The two options (the owner picks)

1. **Build our own minimal authorization server.** Free, no new service, fits
   the "no paid services" rule. It is real work and it is security-critical:
   roughly a migration for three tables, five endpoints, a consent page, token
   issuing and validation, and its own test suite. Design below.
2. **Use a hosted identity provider** (Auth0, WorkOS, Clerk, Stytch…). Much
   less of our code, and they already do DCR, PKCE, resource indicators and
   rotation properly. **Every one of them costs money above a small free tier**,
   so this needs the owner's explicit yes first (CLAUDE.md: a service that
   costs money needs the owner's yes; never sign him up for one).

My recommendation: **option 1**, and only when the cart actually needs it.
Nothing in Phases 1–3 needs sign-in, both directories accept an anonymous
server, and an OAuth server written in a hurry is the worst thing in this
repository to get wrong.

### The design, if option 1 is chosen

Migration 0115:

- `oauth_clients` — `client_id`, `client_name`, `redirect_uris text[]`,
  `token_endpoint_auth_method` ('none' for a public PKCE client),
  `created_at`. Written by the registration endpoint (DCR), service_role only.
- `oauth_codes` — `code_hash` (sha256 only), `client_id`, `user_id`,
  `redirect_uri`, `code_challenge`, `code_challenge_method` ('S256' only),
  `scope`, `resource`, `expires_at` (60 s), `used_at`. One-time.
- `oauth_tokens` — `token_hash`, `refresh_hash`, `client_id`, `user_id`,
  `scope`, `audience`, `expires_at`, `revoked_at`. Opaque random tokens,
  hashed at rest exactly like `plugin_handoffs.token_hash`.

Endpoints:

- `GET /.well-known/oauth-protected-resource` **and**
  `GET /.well-known/oauth-protected-resource/api/mcp` (path-scoped; serve both)
  → `{ resource: "https://gestaltung360.com/api/mcp", authorization_servers:
  ["https://gestaltung360.com"], scopes_supported: [...],
  resource_documentation: "https://gestaltung360.com/legal/privacy" }`.
- `GET /.well-known/oauth-authorization-server` → `issuer`,
  `authorization_endpoint`, `token_endpoint`, `registration_endpoint`,
  `code_challenge_methods_supported: ["S256"]` (if this field is absent a
  client MUST refuse to proceed), `token_endpoint_auth_methods_supported:
  ["none"]`, `scopes_supported`, `authorization_response_iss_parameter_supported:
  true` (then always return `iss`, errors included).
- `POST /api/oauth/register` — DCR. Deprecated in the newest spec in favour of
  CIMD, but kept for the hosts that still use it.
- `GET /[locale]/connect/authorize` — our consent page, EN + AR, in our design,
  scopes in plain words. Requires a real Supabase sign-in (not a guest), shows
  the client name and the redirect host, and on approval issues the code.
- `POST /api/oauth/token` — authorization_code + refresh_token grants, verify
  the PKCE `code_verifier` against the stored S256 challenge, exact
  `redirect_uri` match, one-time code, and bind `audience` from the `resource`
  parameter.

MCP route changes:

- Unauthenticated stays **allowed**: everything in Phases 1–3 must keep working
  without sign-in. Only a scope-requiring tool answers 401 with
  `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`.
- When a bearer token is present: validate it (hash lookup, not revoked, not
  expired) and **check the audience is our MCP URI**. The spec is explicit that
  a server MUST validate that a token was issued for it, and MUST NOT pass a
  client's token upstream.
- Scopes, server-defined: `project:write` (send_project into the account),
  `cart:write` (add_parts_to_cart), `meetings:write` (book with the profile's
  details).

Signed in, the behaviour the brief asks for: `send_project` creates the project
in the user's account with no claim step, and `book_meeting` fills the contact
details from the profile.

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
