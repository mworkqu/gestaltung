# Gestaltung360 plugin

Lets someone design a physical electronic product inside their own Claude and
send it to Gestaltung360 (Lusail, Qatar) to be quoted and made. Their AI does
the thinking on their own subscription; we pay no AI tokens.

## What is in here

```
plugins/gestaltung360/
├── .claude-plugin/plugin.json          the manifest
├── .mcp.json                           our MCP server over Streamable HTTP
└── skills/design-a-product/SKILL.md    when to use it, the steps, the rules
```

The marketplace file that offers this plugin is at the repository root:
`.claude-plugin/marketplace.json`.

Everything the plugin can do comes from the server at
`https://gestaltung360.com/api/mcp` (`app/api/mcp/route.ts`, tools in
`lib/plugin/server/register.ts`). The plugin itself ships no code — only the
manifest, the server reference and one skill — so a tool change needs no new
plugin version.

## Installing it locally (the owner)

From the repository root:

```bash
claude plugin validate ./plugins/gestaltung360
```

```bash
claude plugin validate .
```

```bash
claude plugin marketplace add .
```

```bash
claude plugin install gestaltung360@gestaltung360
```

```bash
claude plugin list
```

Inside a session the same two steps are `/plugin marketplace add .` and
`/plugin install gestaltung360@gestaltung360`.

Edits to these files apply at the next session start, or after
`/reload-plugins`; a local relative-path marketplace needs no version bump. To
start over: `claude plugin marketplace remove gestaltung360`.

## Checking it works

Ask Claude: "Use Gestaltung360 to design an automatic plant waterer for my
balcony." It should ask what it must do, call `get_design_rules`, pick parts by
library id, call `check_project` until it passes, show how it will look, list
what will be sent, and wait for a yes before calling `send_project`.

The plugin's tools appear in `/mcp` as `plugin:gestaltung360:gestaltung360`,
and to hooks and `allowed-tools` as
`mcp__plugin_gestaltung360_gestaltung360__<tool>`.

## Signing in (optional)

Seven of the eight tools work with no account at all. Only
`add_parts_to_cart` needs one, and signing in also saves a sent project
straight into the account and lets a booking use the name and number already
there.

The server is an OAuth 2.1 resource server: it publishes its metadata at
`/.well-known/oauth-protected-resource/api/mcp`, and the authorization server
is Supabase Auth on the project host. Claude registers itself, so there is
nothing to configure in `.mcp.json` — `/mcp` offers to authenticate when a tool
asks for it. The consent screen is on gestaltung360.com; a password is never
shown to Claude, and a connected account still cannot place an order or pay.

## Submitting it to the Claude directory

`docs/PLUGIN_SUBMISSION.md` has the steps, what the reviewer needs and the
test prompts.

## Rules this plugin must keep

Prices in QAR. Never send the conversation — only short quotes of the user's
own words. Never write anything without the user's explicit agreement. Never
name a CAD program to the client. Never say anything is free, and never promise
a reprint or a remake. One service phrase: "within one working day".
