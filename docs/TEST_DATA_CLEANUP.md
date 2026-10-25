# Test data to delete at the end of all phases (one batch)

A running list. Add a row whenever test or demo data is written to production. Nothing here is deleted until the last phase is finished.

| What | Id | Created | Why kept until the end |
|---|---|---|---|
| Demo project "Automatic Small Plant Watering Monitor" (owner account) | `78d00e58-227c-4097-90f2-b11cddc30375` | 2026-10-10 | Source of the wiring-check and cad-model feature videos; kept in case a clip must be re-recorded. |
| Guest demo project "Demo video — plant monitor" | `dd3f63ea-e2fc-4476-aca5-a1e0acb4ac89` | 2026-10-10 | Used to record the idea-to-kit, file-to-part, sketch-to-drawing and store-to-door clips; kept for re-recording. |
| Guest cart line (soil moisture sensor) of the guest demo project above | cart_items row of the guest session that owns `dd3f63ea-...` (id to be read by the dry-run SELECT) | 2026-10-10 | Part of the store-to-door recording; goes with the guest project. |
| Test order #945ea389 "TEST ORDER — please delete" (Fawran, QAR 53.50) | `945ea389...` (full id to be read by the dry-run SELECT) | 2026-09-29 | Checkout and payment-instruction checks; keep as a reference for the order flow until all phases are verified. |
| Inquiry row "TEST LEAD (please ignore)" (plus one test email in the info@ mailbox) | inquiries row, message "TEST LEAD (please ignore)" (id to be read by the dry-run SELECT) | July 2026 (2026-07-05) | Proof that the lead endpoint saves and emails; the email in the mailbox is deleted by hand. |

## To add when the school stage is tested (2026-10-20)

Nothing was written for the school classes stage: migrations 0096 / 0097 are not run and no code of it has
touched the database. When the owner tests it, these rows appear and belong in the table above:

| What | Where to find the id | Why it exists |
|---|---|---|
| The test class | `select id, name, join_code from public.school_classes order by created_at desc limit 5` | Proof a teacher can create a class and print the sheet. |
| Its team(s) + their projects | `select t.id, t.team_name, t.project_id from public.class_teams t join public.school_classes c on c.id = t.class_id where c.name = '<the test class>'` | Proof a team joins with the code and reaches Parts. Deleting the class cascades to the teams; the PROJECTS are separate rows and must be deleted too. |
| Any teacher comment | `select id from public.class_team_comments` | Cascades with the team. |
| The class parts order, if one is placed | `select id, class_id, total_qar from public.part_orders where class_id is not null` | Proof Economy delivery is QAR 0 on a class order. |
| The credit spend rows the test circuits cost | `select id, reason from public.credits_ledger where reason like 'spend:%'` for the test projects | They came out of the teacher's balance; the owner may want them refunded rather than deleted. |

## Dry run 2026-10-10 (read-only; nothing deleted, waiting for the owner's "delete")

| # | Table | Id | What |
|---|---|---|---|
| 1 | projects | `78d00e58-227c-4097-90f2-b11cddc30375` | "Automatic Small Plant Watering Monitor" (owner account, video source) |
| 2 | projects | `dd3f63ea-e2fc-4476-aca5-a1e0acb4ac89` | "Demo video — plant monitor" (guest a66920e9…) |
| 3 | projects | `5a3ae942-fbb5-4850-9df3-b2526ee2d6c6` | "TEST — Solar garden sensor" (2026-09-22) |
| 4 | projects | `fdd2a6c7-397f-4ca7-adc5-f4dcbb45dd5f` | "TEST — Plant monitor" (2026-09-23) |
| 5 | projects | `c3881430-94d3-4c79-9b61-7507a012d582` | "TEST guest project (delete)" (2026-09-29) |
| 6 | part_orders | `945ea389-9e83-4992-9161-628601ab7685` | Test order QAR 53.50, cancelled (2026-09-28) |
| 7 | part_orders | `159b5246-fc35-4167-b491-8bd5354a5982` | "TEST ORDER - please delete" QAR 366, cancelled (2026-09-23) |
| 8 | inquiries | `2f1e6ed7-e202-4e81-b7c4-3cf6b157dcf1` | "TEST LEAD (please ignore)" |
| 9 | inquiries | `e4a966e9-21b9-46c0-b544-a9850c67eb9b` | "TEST contact (please ignore)" |
| 10 | inquiries | `5f90cd3f-7bab-46ba-b5d6-c822f531868d` | "TEST callback (please ignore)" |
| 11 | part_orders | `3cbf6a8c-232f-4eb2-a719-36b5754e96a1` | "TEST — Claude — please delete" QAR 66, cash on delivery, guest (2026-10-10, click-through step 9) |
| 12 | projects | `055c5073-0f0e-477b-b880-e201c6c98791` | "Automatic smart desk lamp" — brief starts "TEST:" (owner account, 2026-10-10, click-through step 6; AI renamed it, so the name has no TEST) |
| 13 | inquiries | lead "TEST — Claude — please delete" (File quote, 10 Oct 2026 13:21) | Click-through step 7; id to be read by the dry-run SELECT |
| 14 | projects | `fbefc059-591e-4a06-887a-8c8557d0856a` | Project created by the step-7 quote (owns TEST-cube.stl in cad-files; delete the file with it) |
| 15 | projects | `47d7814d-30f0-43cc-8fa0-370860819c06` | "TEST drawing — please delete" (click-through step 8) |
| 16 | inquiries | lead "TEST drawing — please delete" (Drawing, 10 Oct 2026 13:26) | Click-through step 8; id to be read by the dry-run SELECT |
| 17 | part_orders | order #75c58b7b… | Cancelled QAR 75 (2026-09-20) — owner: no real orders exist yet, all are tests |
| 18 | part_orders | order #1b0dca20… | Cancelled QAR 425 (2026-07-05) — test |
| 19 | part_orders | order #f28dcf37… | Cancelled QAR 5 (2026-06-22) — test |

Guest cart of the demo guest (a66920e9…): already empty. No rows with is_test = true. The test email in the info@ mailbox is deleted by hand.

## Studio walkthrough live test (2026-10-11)

- Project `89ba3df7-d74c-4b3c-acc7-ac4b4b103704` "Plant Waterer" (brief "TEST automatic small plant watering monitor"), on the owner's account: Studio walked Idea → Enclosure. No request sent.
- Project `150257ef-d0d6-4297-9214-b833a26e6ef5` "TEST W1 claim - delete": created by guest `ad7575eb-f160-4dbd-8116-f7429b1be8e9`, then moved to the owner's account by claim_guest_work (0071 check).
- Guest users `ad7575eb-f160-4dbd-8116-f7429b1be8e9` and one earlier anonymous user from a failed script run (owns nothing): the weekly anonymous cleanup removes them once 30 days old.

## Arabic YouTube video recording (2026-10-12)

- Projects `838c44f8-3ec8-4627-9521-130f2806ce37` and `e5946e41-b746-49c0-b73a-cbbf59af24dc` (Studio "ساقي النباتات التلقائي"), created by guests on /ar by `scripts/record-videos/record.mjs idea-to-kit-ar` (two takes). Nothing was ordered or sent.

## Arabic site-clip recordings (2026-10-17)

- One guest cart line (soil moisture sensor) from `scripts/record-videos/record.mjs store-to-door-ar`; an anonymous guest user owns it. Nothing was ordered. The quote and drawing-request takes were never submitted.

## Added 2026-10-18 (Studio fixes)

- Studio LED-colour / layout check project `21202d7b-e035-4766-bdb9-a1942b71bf1e` "Smart Plant Monitor" (created 2026-10-18 from a local dev server against the live database, guest session). Also its guest user's `credits_ledger` rows (5 welcome ideation tokens + the "New idea" spend), its `idea_sessions` row and the `ai_usage` rows of that project (spec + pick calls).

- Live-site re-test project `6803a44d-b025-4873-967d-cc26891ac834` "Smart Plant Monitor" (created 2026-10-18 on gestaltung360.com, guest session), with its guest user's ideation-token ledger rows, `idea_sessions` row and `ai_usage` rows.

## English site-clip recordings (2026-10-19)

- Guest project `17eee324-310d-4eed-b297-a72a1f9fab51` (Studio plant waterer, `record.mjs idea-to-kit-en`) and one guest cart line (soil moisture sensor, `store-to-door-en`). Nothing ordered; quote and drawing-request takes not submitted.

## Live-site QA run (2026-10-22, `review/qa/REPORT.md` section 11)

The QA tester walked the live site and left these rows. Nothing has been deleted; no SQL
was run. The order is the only one that needs a status change rather than a delete.

| Type | Identifier | Account / contact | Note |
|---|---|---|---|
| Order | `3a939b38-a527-4dc3-901b-c3f89806179f` (shown as #3a939b38) | techshack.orders@gmail.com, +974 3366 4265, name "TEST QA - please cancel" | COD, Lusail, Standard, QAR 56.00. **Cancel it** rather than deleting it, so the order history stays intact. |
| Project | `719b2ec2-a300-4f6f-a7b8-ebcff6412d18` "TEST QA - Balcony Plant Waterer" | Account A | Idea text starts "TEST QA -". Used 1 wiring + 2 CAD credits. |
| Get-it-made request | on project `719b2ec2-a300-4f6f-a7b8-ebcff6412d18` | Account A | Notes "TEST - please ignore. QA test request, no quote needed." Goes with the project. |
| Guest project | `6cc3bf2f-98dd-48c6-9b3e-dca2e6829ce3` "Auto Desk Lamp" | guest | Idea starts "TEST QA -". |
| Drawing request | `bc67437f-d774-47d8-a142-fab7ca944a4b` "TEST QA - حامل جداري (طلب رسم تجريبي)" | techshack.orders+qa-b@gmail.com, +974 3366 4265 | Sketch `test-sketch.png`, tier simple. |
| Quote request | no reference was shown on screen; file `test-bracket.stl`, name "TEST QA - please ignore" | techshack.orders+qa-b@gmail.com | Method "Not sure". Find it by name or by the file name. |
| Contact message | "TEST - please ignore. رسالة تجريبية..." (name "TEST QA - please ignore") | techshack.orders+qa-b@gmail.com | Saved through `/api/store-lead`. |

The cart was emptied by the tester and no accounts were created, so there is nothing to do
for either.

## Already deleted

- Crash-repro project `6b5907f2-c957-43f9-bce8-42e73beeff33` "TEST crash repro — delete" (created 2026-10-09): already deleted by the owner. No action.

## Not listed because no id is recorded

- Any "TEST" guest projects such as "TEST — Plant monitor" or "TEST — Solar garden sensor". CLAUDE.md does not name them. The dry-run SELECT below also searches by name, so they will show up if they still exist.

## How the final cleanup will run

1. **Dry run.** One read-only SELECT lists every row to be removed: the ids above plus anything found by name (`name ilike 'TEST%'` or `name ilike 'Demo video%'` on projects, `is_test = true` on projects, orders and inquiries, the "TEST LEAD" inquiry, the guest cart lines of the listed guest sessions). Nothing is changed.
2. **Owner OK.** The owner reads the list, strikes out anything to keep, and confirms in chat.
3. **One transaction of deletes.** A single `begin; ... commit;` removes the approved rows in dependency order (cart lines, then orders and their items, then projects through `delete_project()`, then the inquiry). The transaction ends by printing the remaining row counts, and it is rolled back if any count is not zero.

No SQL is run until all phases are finished.
