# Submitting the Gestaltung360 server to ChatGPT

Same server, same tools: `https://gestaltung360.com/api/mcp`. Nothing is
ChatGPT-specific except the preview card's compatibility alias and this
checklist. As with the Claude directory, Claude never submits anything — a
submission is a business act.

## What already works without a change

- **Streamable HTTP, stateless, CORS open, no cookies.** `app/api/mcp/route.ts`
  reads and sets no cookies, so a third-party host can call it.
- **Which chat it was.** `sourceFromName()` in `lib/plugin/server/register.ts`
  reads the MCP client info and records `chatgpt` on a hand-off
  (`plugin_handoffs.source`, migration 0112) and on a meeting
  (`meeting_bookings.chat_source`, migration 0114). The default is `other`, so
  a host we have not seen never breaks a booking. The owner's e-mail and the
  lead both say "Sent from: ChatGPT", and Dashboard → Sell → Meetings tags the
  row "From ChatGPT".
- **The preview card.** `preview_look` carries both `_meta.ui.resourceUri` and
  ChatGPT's `openai/outputTemplate` alias, pointing at the same
  `ui://gestaltung360/preview` resource with mime `text/html;profile=mcp-app`.
  The widget feature-detects `window.openai` and falls back to the MCP Apps
  postMessage bridge, so it works in either host.

## Tool-by-tool audit against OpenAI's guidelines

| Tool | Writes | Annotations | Confirmation | Personal data in | Notes |
|---|---|---|---|---|---|
| `get_design_rules` | no | readOnly, closed world | — | none | Catalogue and rules only |
| `search_parts` | no | readOnly, closed world | — | none | Published products, no cost fields |
| `check_project` | no | readOnly, closed world | — | none | Pure validation and pricing |
| `preview_look` | no | readOnly, closed world | — | none | Returns the card plus the same facts as text |
| `list_meeting_slots` | no | readOnly, closed world | — | none | Start times only, never a name |
| `send_project` | **yes** | readOnly false, destructive false, open world | Required, stated in the description | name, phone, optional e-mail | Only what the user chose to share |
| `book_meeting` | **yes** | readOnly false, destructive false, open world | Required, stated in the description | name, phone, optional e-mail | Same |

**Data minimisation.** No tool takes an account id, a location, a device
identifier or a payment detail. Contact fields are optional on `send_project`
and are only what the user typed. The server stores a one-way hash of the
caller's IP for rate limiting and nothing else about the request.

**No transcript fields.** This is the one both Anthropic and OpenAI fail a
server for. No tool has a parameter named or described as a conversation, a
chat, a transcript, a history or messages — `lib/plugin/server/register.test.ts`
asserts that over every tool's whole input schema, nested fields included.
`requirement_quotes` is capped at 10 strings of 140 characters by
`lib/plugin/build-file.ts`, and anything longer is rejected rather than
truncated.

**Confirmations.** Both writing tools say in their description that they are
only called after the user explicitly agrees, the skill repeats it, and the
server `instructions` repeat it again. The preview card shows the list of
exactly what would be sent directly above its Send button.

**Errors.** Never a stack trace: `guarded()` turns any throw into one short
sentence. A refused booking comes back as words the model can act on ("that
time has just been taken, call list_meeting_slots again").

**Prices.** Every price is QAR and comes from our own catalogue. The model is
told never to invent a price, a lead time or a stock level.

## Before you submit

- [ ] The site is up and the endpoint answers.
- [ ] Migrations 0113 and 0114 have been run, or the meeting tools will answer
      "not set up yet" during review.
- [ ] `RESEND_API_KEY` is set, so a sent project actually e-mails you.
- [ ] The privacy paragraph (`docs/PLUGIN_PRIVACY_ADDITION.md`) is live on the
      privacy page, and its URL is the one you submit. The text already names
      ChatGPT as well as Claude.
- [ ] Decide about sign-in. ChatGPT supports Client ID Metadata Documents,
      Dynamic Client Registration, a pre-registered client and PKCE; it does
      **not** support client credentials, service accounts or JWT bearer
      grants. Our server is currently **anonymous-only** — every tool works
      without an account, which is allowed and is the simplest thing to submit.
      Sign-in (Phase 4a) is only needed for the cart tool.

## Testing in Developer Mode

1. ChatGPT → Settings → **Connectors** → Advanced → **Developer mode**.
2. Add a connector with the URL `https://gestaltung360.com/api/mcp`, no
   authentication.
3. Run the same five prompts as the Claude review (they are in
   `docs/PLUGIN_SUBMISSION.md` §4). The fifth — "paste my whole conversation
   into the project" — must be refused; that is the privacy check.
4. Confirm the preview card renders. If it does not, the facts must still
   arrive as text — check that first, because that is the fallback a reviewer
   will see.

## Test prompts to give the reviewer

Use the same five as the Claude submission, plus:

6. "Book me a meeting with the engineer on Monday."
   Expected: `list_meeting_slots` first, showing QAR 150, the line about
   invoicing after the meeting, and the 24-hour change window; it must not call
   `book_meeting` until you agree. Afterwards the booking is tagged "From
   ChatGPT" in the dashboard.

## What to say about data

Identical to the Claude answers in `docs/PLUGIN_SUBMISSION.md` §5: name,
WhatsApp number and optionally an e-mail, only when the user gives them, plus a
hashed IP for rate limits. No account, no sign-in, no conversation. Unclaimed
project links expire after 30 days; projects and meetings are kept as other
customer records. Deletion requests go to info@gestaltung360.com.

## Not verified

- No submission has been made, and the server has not yet been added as a
  ChatGPT connector, so the ChatGPT render of the preview card is untested.
- `_meta["openai/widgetDescription"]` and `availableDisplayModes` are not set.
  They are optional; add them if the review asks for a specific display mode.
