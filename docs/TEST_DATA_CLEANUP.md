# Test data to delete at the end of all phases (one batch)

A running list. Add a row whenever test or demo data is written to production. Nothing here is deleted until the last phase is finished.

| What | Id | Created | Why kept until the end |
|---|---|---|---|
| Demo project "Automatic Small Plant Watering Monitor" (owner account) | `78d00e58-227c-4097-90f2-b11cddc30375` | 2026-10-10 | Source of the wiring-check and cad-model feature videos; kept in case a clip must be re-recorded. |
| Guest demo project "Demo video — plant monitor" | `dd3f63ea-e2fc-4476-aca5-a1e0acb4ac89` | 2026-10-10 | Used to record the idea-to-kit, file-to-part, sketch-to-drawing and store-to-door clips; kept for re-recording. |
| Guest cart line (soil moisture sensor) of the guest demo project above | cart_items row of the guest session that owns `dd3f63ea-...` (id to be read by the dry-run SELECT) | 2026-10-10 | Part of the store-to-door recording; goes with the guest project. |
| Test order #945ea389 "TEST ORDER — please delete" (Fawran, QAR 53.50) | `945ea389...` (full id to be read by the dry-run SELECT) | 2026-09-29 | Checkout and payment-instruction checks; keep as a reference for the order flow until all phases are verified. |
| Inquiry row "TEST LEAD (please ignore)" (plus one test email in the info@ mailbox) | inquiries row, message "TEST LEAD (please ignore)" (id to be read by the dry-run SELECT) | July 2026 (2026-07-05) | Proof that the lead endpoint saves and emails; the email in the mailbox is deleted by hand. |

## Already deleted

- Crash-repro project `6b5907f2-c957-43f9-bce8-42e73beeff33` "TEST crash repro — delete" (created 2026-10-09): already deleted by the owner. No action.

## Not listed because no id is recorded

- Any "TEST" guest projects such as "TEST — Plant monitor" or "TEST — Solar garden sensor". CLAUDE.md does not name them. The dry-run SELECT below also searches by name, so they will show up if they still exist.

## How the final cleanup will run

1. **Dry run.** One read-only SELECT lists every row to be removed: the ids above plus anything found by name (`name ilike 'TEST%'` or `name ilike 'Demo video%'` on projects, `is_test = true` on projects, orders and inquiries, the "TEST LEAD" inquiry, the guest cart lines of the listed guest sessions). Nothing is changed.
2. **Owner OK.** The owner reads the list, strikes out anything to keep, and confirms in chat.
3. **One transaction of deletes.** A single `begin; ... commit;` removes the approved rows in dependency order (cart lines, then orders and their items, then projects through `delete_project()`, then the inquiry). The transaction ends by printing the remaining row counts, and it is rolled back if any count is not zero.

No SQL is run until all phases are finished.
