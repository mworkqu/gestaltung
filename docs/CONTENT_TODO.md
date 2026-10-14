# CAD Champions: content to supply

Each `[TODO-MO: …]` placeholder below needs real content from Mo. Remove the line once the content is in.

| # | Placeholder | Where it shows | File | Added |
|---|---|---|---|---|
| 1 | `[TODO-MO: brand colors and logo]` | Header mark on every CC page; design tokens | `components/cad-champions/shell/cc-mark.tsx`, `lib/cad-champions/tokens.ts` | Prompt 1 |
| 2 | `[TODO-MO: full address / PO box]` | Footer of every CC page (the visible line under "Rafal Tower, Lusail, Qatar") | `messages/cad-champions/{en,ar}/shell.json` → `footer.addressTodo` | Prompt 1 |
| 3 | `[TODO-MO: privacy policy text]` | `/cad-champions/{en,ar}/privacy` (drafted in Prompt 12) | `messages/cad-champions/{en,ar}/pages.json` → `privacy.body` | Prompt 1 |
| 4 | `[TODO-MO: terms of use text]` | `/cad-champions/{en,ar}/terms` (drafted in Prompt 12) | `messages/cad-champions/{en,ar}/pages.json` → `terms.body` | Prompt 1 |

## Settings to provide (not placeholders)
- `WHATSAPP_NUMBER`: digits only, for example 974XXXXXXXX. Until it is set, the "Need help?" sheet falls back to `NEXT_PUBLIC_WHATSAPP_NUMBER`. If neither is set, the WhatsApp row is hidden.
- `SUPPORT_EMAIL`: defaults to info@gestaltung360.com.
