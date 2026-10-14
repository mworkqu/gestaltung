# CAD Champions: content to supply

Each `[TODO-MO: …]` placeholder below needs real content from Mo. Remove the line once the content is in.

| # | Placeholder | Where it shows | File | Added |
|---|---|---|---|---|
| 1 | `[TODO-MO: brand colors and logo]` | Header mark on every CC page; design tokens | `components/cad-champions/shell/cc-mark.tsx`, `lib/cad-champions/tokens.ts` | Prompt 1 |
| 2 | `[TODO-MO: full address / PO box]` | Footer of every CC page (the visible line under "Rafal Tower, Lusail, Qatar") | `messages/cad-champions/{en,ar}/shell.json` → `footer.addressTodo` | Prompt 1 |
| 3 | `[TODO-MO: privacy policy text]` | `/cad-champions/{en,ar}/privacy` (drafted in Prompt 12) | `messages/cad-champions/{en,ar}/pages.json` → `privacy.body` | Prompt 1 |
| 4 | `[TODO-MO: terms of use text]` | `/cad-champions/{en,ar}/terms` (drafted in Prompt 12) | `messages/cad-champions/{en,ar}/pages.json` → `terms.body` | Prompt 1 |
| 2D-1 | `[TODO-MO: training contents]` | Dashboard Training card, "What you get" bullet | `messages/cad-champions/{en,ar}/dashboard.json` → `training.bullets.one` | Prompt 2 |
| 2D-2 | `[TODO-MO: confirm the local Qatar rule]` | Tooltip on "Competition age-eligible until <year>" (birth year + 22) | `messages/cad-champions/{en,ar}/dashboard.json` → `eligibility.help` | Prompt 2 |
| 2C-1 | `[TODO-MO: confirm institution list]` | Sign-up "School or university" dropdown (`/cad-champions/{en,ar}/sign-up`): QU, HBKU, UDST (CNA-Q), Texas A&M Qatar, CMU-Q, Georgetown Q, Northwestern Q, VCUarts Q, Qatar Academy, "A secondary school", Other | `lib/cad-champions/auth/schema.ts` → `CC_INSTITUTIONS`; labels `messages/cad-champions/{en,ar}/auth.json` → `options.institution` | Prompt 2 |
| 2D-3 | `[TODO-MO: retention days]` | Account settings, delete-account text and confirm dialog | `messages/cad-champions/{en,ar}/account.json` → `deletion.retention`, `deletion.dialogBody` | Prompt 2 |

## Settings to provide (not placeholders)
- `WHATSAPP_NUMBER`: digits only, for example 974XXXXXXXX. Until it is set, the "Need help?" sheet falls back to `NEXT_PUBLIC_WHATSAPP_NUMBER`. If neither is set, the WhatsApp row is hidden.
- `SUPPORT_EMAIL`: defaults to info@gestaltung360.com.
