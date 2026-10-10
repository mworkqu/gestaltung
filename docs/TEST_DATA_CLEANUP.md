# Test data to delete at the end of all phases (one batch)

A running list. Add a row whenever test or demo data is written to production. Nothing here is deleted until the last phase is finished.

| What | Id | Created | Why kept until the end |
|---|---|---|---|
| Demo project "Automatic Small Plant Watering Monitor" (owner account) | `78d00e58-227c-4097-90f2-b11cddc30375` | 2026-10-10 | Source of the wiring-check and cad-model feature videos; kept in case a clip must be re-recorded. |
| Guest demo project "Demo video — plant monitor" | `dd3f63ea-e2fc-4476-aca5-a1e0acb4ac89` | 2026-10-10 | Used to record the idea-to-kit, file-to-part, sketch-to-drawing and store-to-door clips; kept for re-recording. |
| Guest cart line (soil moisture sensor) of the guest demo project above | cart_items row of the guest session that owns `dd3f63ea-...` (id to be read by the dry-run SELECT) | 2026-10-10 | Part of the store-to-door recording; goes with the guest project. |
| Test order #945ea389 "TEST ORDER — please delete" (Fawran, QAR 53.50) | `945ea389...` (full id to be read by the dry-run SELECT) | 2026-09-29 | Checkout and payment-instruction checks; keep as a reference for the order flow until all phases are verified. |
| Inquiry row "TEST LEAD (please ignore)" (plus one test email in the info@ mailbox) | inquiries row, message "TEST LEAD (please ignore)" (id to be read by the dry-run SELECT) | July 2026 (2026-07-05) | Proof that the lead endpoint saves and emails; the email in the mailbox is deleted by hand. |

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

Guest cart of the demo guest (a66920e9…): already empty. No rows with is_test = true. The test email in the info@ mailbox is deleted by hand.

## Already deleted

- Crash-repro project `6b5907f2-c957-43f9-bce8-42e73beeff33` "TEST crash repro — delete" (created 2026-10-09): already deleted by the owner. No action.

## Not listed because no id is recorded

- Any "TEST" guest projects such as "TEST — Plant monitor" or "TEST — Solar garden sensor". CLAUDE.md does not name them. The dry-run SELECT below also searches by name, so they will show up if they still exist.

## How the final cleanup will run

1. **Dry run.** One read-only SELECT lists every row to be removed: the ids above plus anything found by name (`name ilike 'TEST%'` or `name ilike 'Demo video%'` on projects, `is_test = true` on projects, orders and inquiries, the "TEST LEAD" inquiry, the guest cart lines of the listed guest sessions). Nothing is changed.
2. **Owner OK.** The owner reads the list, strikes out anything to keep, and confirms in chat.
3. **One transaction of deletes.** A single `begin; ... commit;` removes the approved rows in dependency order (cart lines, then orders and their items, then projects through `delete_project()`, then the inquiry). The transaction ends by printing the remaining row counts, and it is rolled back if any count is not zero.

No SQL is run until all phases are finished.
