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
| 3-1 | `[TODO-MO: years of experience]`, `[TODO-MO: students trained]`, `[TODO-MO: third fact]` | Landing trust strip, under "By Gestaltung360…" (`/cad-champions/{en,ar}`) | `messages/cad-champions/{en,ar}/landing.json` → `trust.facts.one/two/three` | Prompt 3 |
| 3-2 | `[TODO-MO: trainer name]`, `[TODO-MO: trainer role]` | Landing "Your trainer and studio" card | `messages/cad-champions/{en,ar}/landing.json` → `studio.trainerName`, `studio.trainerRole` | Prompt 3 |
| 3-3 | `[TODO-MO: trainer bio]` | Landing "Your trainer and studio" card | `messages/cad-champions/{en,ar}/landing.json` → `studio.bio` | Prompt 3 |
| 3-4 | Trainer photo + studio photo (placeholder boxes "photo coming soon") | Landing "Your trainer and studio" | `app/[locale]/cad-champions/page.tsx` section 8 (replace the dashed boxes with next/image) | Prompt 3 |
| 3-5 | `[TODO-MO: confirm the local Qatar rule]` (age 22 or younger) | Landing FAQ "Who can take part?" | `messages/cad-champions/{en,ar}/landing.json` → `faq.items.eligibility.a` | Prompt 3 |
| 3-6 | Equipment list (3D printers, 3D scanner, CNC, laser cutter) taken from the plan: confirm the studio really has a 3D scanner | Landing "In the studio" list | `messages/cad-champions/{en,ar}/landing.json` → `studio.equipment.*` | Prompt 3 |
| 4-1 | `[TODO-MO: can students use studio computers?]` | Get Ready step 2 "Check your computer": alert shown when the profile says "no computer" (`/cad-champions/{en,ar}/get-ready`) | `messages/cad-champions/{en,ar}/get-ready.json` → `computer.noComputerText` | Prompt 4 |
| 4-2 | `[TODO-MO: confirm offer]` ("Contact us for help getting a SOLIDWORKS licence") | Get Ready step 3, SOLIDWORKS tab | `messages/cad-champions/{en,ar}/get-ready.json` → `software.solidworksOffer` | Prompt 4 |
| 4-3 | `[TODO-MO: screenshot of Settings > System > About]` | Get Ready step 2, illustration box under "How to find your RAM and Windows version" | `messages/cad-champions/{en,ar}/get-ready.json` → `computer.illustration`; box in `components/cad-champions/get-ready/step-computer.tsx` | Prompt 4 |
| 4-4 | `[TODO-MO: record video: What is the competition and what is this test?]` | Get Ready step 1 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `get_ready_welcome` (set provider + providerId) | Prompt 4 |
| 4-5 | `[TODO-MO: record video: Install Autodesk Inventor with a free education licence]` | Get Ready step 3, Inventor tab (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `install_inventor` (set provider + providerId) | Prompt 4 |
| 4-6 | `[TODO-MO: record video: Install Autodesk Fusion with a free education licence]` | Get Ready step 3, Fusion tab (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `install_fusion` (set provider + providerId) | Prompt 4 |
| 4-7 | `[TODO-MO: record video: Getting SOLIDWORKS as a student]` | Get Ready step 3, SOLIDWORKS tab (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `install_solidworks` (set provider + providerId) | Prompt 4 |
| 4-8 | `[TODO-MO: record video: Set your units to millimetres]` | Get Ready step 4, action 1 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_units_mm` (set provider + providerId) | Prompt 4 |
| 4-9 | `[TODO-MO: record video: Set the material and density]` | Get Ready step 4, action 2 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_material_density` (set provider + providerId) | Prompt 4 |
| 4-10 | `[TODO-MO: record video: Export a STEP file]` | Get Ready step 4, action 3 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_export_step` (set provider + providerId) | Prompt 4 |
| 4-11 | `[TODO-MO: record video: Export a drawing as PDF]` | Get Ready step 4, action 4 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_export_pdf` (set provider + providerId) | Prompt 4 |
| 4-12 | `[TODO-MO: record video: Find your exported files and upload them]` | Get Ready step 4, action 5 (`/cad-champions/{en,ar}/get-ready`) | `lib/cad-champions/videos/registry.ts` → slot `action_find_upload` (set provider + providerId) | Prompt 4 |

## Settings to provide (not placeholders)
- `WHATSAPP_NUMBER`: digits only, for example 974XXXXXXXX. Until it is set, the "Need help?" sheet falls back to `NEXT_PUBLIC_WHATSAPP_NUMBER`. If neither is set, the WhatsApp row is hidden.
- `SUPPORT_EMAIL`: defaults to info@gestaltung360.com.

## Help articles (0079 seed)
- Help articles: [TODO-MO: confirm studio computer access] in i-only-have-a-mac
- Help articles: [TODO-MO: can students use studio computers?] in i-dont-have-a-computer
- Help articles: [TODO-MO: confirm 48h] in how-grading-works
- Help articles: [TODO-MO: confirm 48h] in why-is-my-score-provisional
- Help articles: [TODO-MO: training contents] in whats-included-in-the-training
- Help articles: [TODO-MO: confirm approval time and working hours] in how-long-until-payment-is-approved
- Help articles: [TODO-MO: refund policy - eligibility window, conditions, how the refund is paid, and who to contact] in refunds
- Help articles: [TODO-MO: retention days] in deleting-my-account
- Help articles: [TODO-MO: privacy policy - review this summary against the full privacy policy] in privacy
- Help articles: [TODO-MO: kit contents and price] in allowed-measuring-instruments
