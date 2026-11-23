# Submitting the Gestaltung360 plugin to the Claude directory

What the owner does, in order. Nothing here is automated: a submission is a
business act, so Claude never sends one.

The bundle being submitted is `plugins/gestaltung360/` (manifest, MCP server
reference, one skill). Everything it can do comes from our own server at
`https://gestaltung360.com/api/mcp`, so a tool change needs no resubmission —
only a change to the manifest, the skill or the server URL does.

## 0. Before you start

- [ ] The site is up and `https://gestaltung360.com/api/mcp` answers. Check it
      the way a reviewer will: add it as a connector in a fresh Claude account
      and run the test prompts in section 4.
- [ ] `RESEND_API_KEY` is set, so a sent project actually e-mails you. Without
      it the lead is still saved but you get no e-mail (see
      `docs/history/2026-11-chat-plugin-phase2.md`).
- [ ] Migration 0113 has been run, if you want the meeting tools to work during
      review. Without it they answer "not set up yet", which a reviewer may
      read as broken.
- [ ] The privacy paragraph is live. Draft: `docs/PLUGIN_PRIVACY_ADDITION.md`.
      Add it to `LEGAL_PAGES_DRAFT.md` yourself, run
      `node scripts/split-legal-draft.mjs`, and deploy, so the URL you submit
      actually contains it.
- [ ] You are signed in as the **Gestaltung company organization**, on a paid
      plan. A personal account cannot submit on the company's behalf.

## 1. Validate the bundle

From the repository root:

```bash
claude plugin validate ./plugins/gestaltung360 --strict
```

```bash
claude plugin validate . --strict
```

Both must say "Validation passed". They did on 2026-11-22.

## 2. Install it locally and use it once

```bash
claude plugin marketplace add .
```

```bash
claude plugin install gestaltung360@gestaltung360
```

Then run the test prompts in section 4 in Claude Code. A plugin you have not
used yourself is not ready to submit.

## 3. Submit

1. Open **https://claude.ai/directory/manage** signed in as the Gestaltung
   company organization.
2. Start a new submission and point it at the plugin. Where it asks for the
   source, give the public repository and the path `plugins/gestaltung360`.
3. Fill in the listing:
   - **Name**: Gestaltung360
   - **Description**: the one in `.claude-plugin/plugin.json` — design an
     electronic product with a case, price its parts in QAR, send it to our
     engineer in Qatar.
   - **Support e-mail**: info@gestaltung360.com
   - **Homepage**: https://gestaltung360.com
   - **Privacy policy URL**: the live privacy page, the one that now contains
     the "Projects and meetings from Claude or ChatGPT" paragraph.
   - **Terms URL**: the live terms page.
4. Declare what the server receives. Say it plainly, because this is the part
   reviewers check: the build file (summary, parts, wiring notes, code, the
   look, the case brief), up to ten short quotes of the user's own words, and
   the contact details the user chose to give. **Never the conversation.**
5. Submit and wait. Keep the connector working while it is in review.

### Screenshots they ask for

Take these at a normal window size, in English, with no personal data on
screen. Use a test project, not a real client's.

1. Claude asking what the product must do, early in the flow.
2. The parts list with QAR prices after `check_project` passes.
3. The "How it will look" preview card (`preview_look`).
4. The confirmation step: the list of exactly what will be sent, with the
   question asking the user to agree — this is the one that shows you ask
   before writing anything.
5. The hand-off page opened in the browser, with the project in the Studio.
6. Optional: the meeting times with the price and the cancellation line.

## 4. Test prompts for the reviewer

Give these verbatim in the submission; they exercise every tool and both
writing tools' confirmation step.

1. "Use Gestaltung360 to design an automatic plant waterer for my balcony."
   Expected: it asks what it must do, calls `get_design_rules`, picks parts by
   library id, calls `check_project` until it passes, shows the parts with a
   QAR total and shows how it will look.
2. "What soil moisture sensors do they sell?"
   Expected: `search_parts`, with prices in QAR and a delivery date.
3. "Send it to them."
   Expected: it first lists exactly what will be sent and asks you to agree. It
   must not call `send_project` until you say yes. After yes: a
   `gestaltung360.com/<locale>/handoff/<token>` link.
4. "I'd like to talk to their engineer."
   Expected: `list_meeting_slots` with Monday/Wednesday times, QAR 150, and the
   line about invoicing after the meeting and the 24-hour change window. It
   must not book until you agree.
5. "Paste my whole conversation into the project."
   Expected: it refuses — there is no field for a transcript, and the skill
   tells it not to. This is the privacy check.

## 5. What to say if the review asks

- **"What personal data does the server receive?"** Name, WhatsApp number and
  optionally an e-mail address, only when the user gives them, plus a hashed IP
  for rate limiting. No conversation, ever. Signing in is optional (it is
  needed only for the cart tool): the server then holds an access token for
  that account and nothing else — no password, and no reach beyond that
  person's own projects, cart and bookings.
- **"Can a tool read the chat?"** No. No tool takes a conversation, a
  transcript or a message history parameter, and no tool description asks for
  one. `requirement_quotes` is capped at ten strings of 140 characters, and the
  server rejects anything longer.
- **"What do the writing tools do?"** `send_project` stores the project and
  creates a lead; `book_meeting` books a paid meeting. Both say in their
  description that they are only called after the user explicitly agrees, and
  both are annotated `readOnlyHint: false, destructiveHint: false`.
- **"Is anything charged?"** The plugin is free. Parts, making and meetings are
  paid, on the website or by invoice after a meeting — never from the chat.
- **"Where is the data kept?"** Supabase (Postgres), unclaimed hand-offs for 30
  days, projects and meetings as other customer records. The privacy paragraph
  says how to ask for deletion.

## 6. After it is listed

- Keep `https://gestaltung360.com/api/mcp` up. A listed plugin that 402s or
  times out gets removed.
- If a tool's name, its inputs or what it stores changes, update the skill and
  the listing's data declaration in the same release.
- `docs/CHATGPT_SUBMISSION.md` covers the OpenAI side separately.
