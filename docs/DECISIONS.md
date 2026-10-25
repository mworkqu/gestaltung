# Owner decisions D1-D13

Owner site review, 2026-10-03. Source prompt: `docs/history/prompts/STAGE_SITE_REVIEW_FIXES_PROMPT.md`. One commit per phase (A-I). Copied from the pre-audit `CLAUDE.md` (`docs/history/CLAUDE-2026-10-full.md`, "Site review decisions"). These are in force unless the owner says otherwise.

| # | Topic | Decision |
|---|---|---|
| D1 | Shipping | QAR 50 for every tier, handling 0. Free delivery over QAR 300 goods subtotal on **Standard only**; Express is never free (Economy also stays QAR 50). |
| D2 | Handling fee | Removed (0, line hidden when 0). |
| D3 | Checkout total | The checkout total is binding. Cart line: "This is your final price. We confirm your order on WhatsApp." |
| D4 | VLT codes | Hide VLT codes from customers (cards, product page, cart). Keep them in the product URL, the order confirmation email and admin pages. |
| D5 | Guests | Guests on /dashboard and /inventory are redirected to /projects. |
| D6 | Projects | Projects stay in this browser; optional email on /projects/new; when given, email the project link to it. |
| D7 | Cookies and analytics | Cookie notice (Accept / Decline); GA4 only after Accept; no Google Signals. |
| D8 | Legal pages | Legal pages come from `LEGAL_PAGES_DRAFT.md` exactly as written (EN + AR, four routes: /delivery-returns, /warranty, /terms, /privacy). Keep "Last updated". Skip the header note. Do not soften wording. |
| D9 | Products | Keep all published products. |
| D10 | WhatsApp | Publish WhatsApp +974 3366 4265 on Contact, footer, checkout, 404. |
| D11 | About page | Founded 2026; Prusa MK4 3D printer, CNC machining, laser cutting, electronics prototyping; no photo for now. |
| D12 | Address and hours | Address: Rafal Tower, Lusail, Qatar. Hours not given, so omit them. |
| D13 | Categories | Category consolidation: show the mapping table and wait for approval. |

## Related items from the same review

- **B7:** do NOT publish "1 free revision; you own the files". /design/drawing gets one line "See what the price includes" -> /warranty.
- **Phase A:** migration 0044 sets shipping outright, makes email required server-side for bank transfer, rejects 0-total orders, adds the free-delivery threshold.
- **Phase I:** the 30-day expiry of the QAR 20 redemption runs from the day the credit is earned.

## Notes

- The pre-audit `CLAUDE.md` still said in its permanent notes that the WhatsApp number was not published yet (env var `NEXT_PUBLIC_WHATSAPP_NUMBER`, falling back to /contact; "owner chose not to publish the number publicly until launch"). D10 (above) is the later, dated decision; the current `CLAUDE.md` keeps that permanent note unchanged.
- Other owner rules (no paid subscriptions, no reprint promises, legal wording unchanged) are in `CLAUDE.md` "Hard rules".
