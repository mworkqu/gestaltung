# Chat plugin — Phase 3: the plugin package and the in-chat look (2026-11-22)

Branch `plugin-phases`, on top of Phase 2. Nothing pushed or merged. No
migration in this phase.

## 3a. The plugin bundle

The formats were taken from the current docs, not guessed
(`code.claude.com/docs`: manifest-reference, components, create-marketplace,
marketplace-reference, mcp, skills — read 2026-11-22).

```
plugins/gestaltung360/
├── .claude-plugin/plugin.json          name, author OBJECT, homepage, keywords
├── .mcp.json                           { mcpServers: { gestaltung360: { type: "http", url: … } } }
├── skills/design-a-product/SKILL.md    when to use it, the 7 steps, the rules
└── README.md                           install, test, what the rules are
.claude-plugin/marketplace.json         name, owner, plugins[{ source: "./plugins/gestaltung360" }]
```

Both files pass the real CLI, in strict mode:

```bash
claude plugin validate ./plugins/gestaltung360 --strict   # ✔ passed
claude plugin validate . --strict                          # ✔ passed
```

Two things worth knowing. `author` must be an **object** (`{name, email, url}`),
not a string — a string is undocumented. And the plugin ships **no code**: all
behaviour comes from `https://gestaltung360.com/api/mcp`, so changing a tool
needs no new plugin version and no resubmission.

`docs/PLUGIN_SUBMISSION.md` has the directory steps, the screenshots, the
reviewer test prompts (including "paste my whole conversation into the project",
which must be refused) and the answers to the data questions a reviewer asks.

## 3b. "How it will look" (MCP Apps UI)

Read-only tool `preview_look` plus the resource `ui://gestaltung360/preview`,
mime `text/html;profile=mcp-app`. The tool carries `_meta.ui.resourceUri` (the
MCP Apps spec 2026-01-26, stable) **and** `openai/outputTemplate`, ChatGPT's
alias for the same resource, so one server serves both hosts.

The widget (`lib/plugin/server/preview-widget.ts`) is one self-contained HTML
document — all CSS and JS inline, nothing fetched at render time, about 13 kB,
far inside the 300 kB budget. The host bridge is hand-rolled JSON-RPC 2.0 over
`window.postMessage` (`ui/notifications/tool-result`, `tools/call`,
`ui/message`, `ui/notifications/size-changed`) with ChatGPT's legacy
`window.openai` globals feature-detected as a fallback. **No new dependency**:
`@modelcontextprotocol/ext-apps` was deliberately not added, because the
project pins `@modelcontextprotocol/server` 2.4.0 and the SDK's surface is not
something to take on trust for one card.

It shows the case, the parts with their QAR prices, the total, the list of
exactly what would be sent, and two buttons that call `send_project` and
`list_meeting_slots` back through the host. Clicking Send **is** the explicit
agreement, and the list of what goes is on screen above it.

A client with no MCP Apps support gets the same facts in the tool's `content`
text, and the hand-off page remains the full preview.

### One deliberate deviation from the brief

The brief said to render the enclosure in the widget with our browser geometry
(the Studio geometry worker / OpenSCAD WASM from jsDelivr). The widget instead
draws the case **proportionally from its template** in inline SVG, with no
millimetre figures, for two reasons:

1. The MCP Apps spec does not say whether WebAssembly is allowed inside the
   mandatory sandboxed iframe (the default CSP it defines has no
   `wasm-unsafe-eval`, and the spec never mentions WASM). A preview that
   silently fails in a reviewer's client is worse than an honest drawing.
2. CLAUDE.md forbids invented numbers, and a dimensioned case drawn in the chat
   that disagrees with what the engineer finally models would be exactly that.

`cdn.jsdelivr.net` is declared in the resource's `_meta.ui.csp.resourceDomains`
so a lazy engine can be added later without a spec change, and nothing loads
from it today. **This needs the owner's nod**: if he wants the real 3D view in
the chat, it is a follow-up once a host is confirmed to allow WASM in the frame.

Also worth flagging: the research found the spec's own init handshake
inconsistent (prose says `ui/initialize`, its example sends `initialize`), and
that MCP Apps and OpenAI disagree on whether `structuredContent` reaches the
model. The widget sends `ui/initialize` and tolerates no answer, and the payload
is written so that nothing in it would embarrass us if the model did read it.

## 3c. Privacy text

`docs/PLUGIN_PRIVACY_ADDITION.md`: a proposed EN + AR paragraph, "Projects and
meetings from Claude or ChatGPT" — what we receive, what we never receive (the
conversation), why, how long, and how to ask for deletion. The numbers in it
match the code (30 days from migration 0112; ten quotes of 140 characters from
`lib/plugin/build-file.ts`). **The owner adds it to `LEGAL_PAGES_DRAFT.md`
himself** and runs `scripts/split-legal-draft.mjs`; Claude never edits the
legal pages (decision D8).

## Checks

typecheck, lint (0 errors, 303 warnings, ratchet holds), 5386 tests in 430
files, i18n parity, `npm run build`, and both `claude plugin validate --strict`
runs all pass.

## Not verified

- No host has rendered the widget yet. The bridge method names come from the
  stable spec but parts of the report they came from were summary-derived, so
  the first real render in Claude and in ChatGPT is the test that matters.
- The plugin has not been installed from the marketplace in a session, nor
  submitted to the directory.
- `preview_look` has not been called against production (it is read-only and
  safe to try once the branch is deployed).
