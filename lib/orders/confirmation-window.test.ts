import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { claimConfirmation, CONFIRMATION_WINDOW_MS, confirmationAllowed, releaseConfirmation } from "./confirmation-window";

const NOW = new Date("2026-10-22T12:00:00Z");
const MIN = 60_000;
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN).toISOString();
const order = (over: Record<string, unknown> = {}) => ({ customer_email: "a@b.qa", confirmation_emailed_at: null, created_at: ago(5), ...over });

describe("confirmationAllowed", () => {
  it("allows a fresh, un-emailed order with an address", () => {
    expect(confirmationAllowed(order(), NOW)).toBe(true);
    expect(confirmationAllowed(order({ created_at: ago(0) }), NOW)).toBe(true);
  });

  it("window boundary: 59 min ok, exactly 60 min ok, 61 min refused", () => {
    expect(confirmationAllowed(order({ created_at: ago(59) }), NOW)).toBe(true);
    expect(confirmationAllowed(order({ created_at: ago(60) }), NOW)).toBe(true);
    expect(confirmationAllowed(order({ created_at: ago(61) }), NOW)).toBe(false);
    expect(CONFIRMATION_WINDOW_MS).toBe(3_600_000);
  });

  it("refuses an order already emailed, however fresh", () => {
    expect(confirmationAllowed(order({ confirmation_emailed_at: ago(1) }), NOW)).toBe(false);
  });

  it("refuses a missing order or one without an address", () => {
    expect(confirmationAllowed(null, NOW)).toBe(false);
    expect(confirmationAllowed(undefined, NOW)).toBe(false);
    expect(confirmationAllowed(order({ customer_email: null }), NOW)).toBe(false);
    expect(confirmationAllowed(order({ customer_email: "" }), NOW)).toBe(false);
  });

  it("accepts the clock as a Date or epoch milliseconds", () => {
    expect(confirmationAllowed(order({ created_at: ago(59) }), NOW.getTime())).toBe(true);
    expect(confirmationAllowed(order({ created_at: ago(61) }), NOW.getTime())).toBe(false);
  });
});

/** part_orders stand-in: one row with a nullable claim stamp. */
function fakeOrders(initial: string | null) {
  const row = { confirmation_emailed_at: initial };
  const ops: string[] = [];
  const db = {
    from: (table: string) => ({
      update: (patch: { confirmation_emailed_at: string | null }) => {
        let onlyIfNull = false;
        const q = {
          eq: () => q,
          is: () => {
            onlyIfNull = true;
            return q;
          },
          select: async () => {
            if (onlyIfNull && row.confirmation_emailed_at !== null) return { data: [] };
            row.confirmation_emailed_at = patch.confirmation_emailed_at;
            ops.push(`${table}:claim`);
            return { data: [{ id: "o1" }] };
          },
          then: (resolve: (v: unknown) => void) => {
            row.confirmation_emailed_at = patch.confirmation_emailed_at;
            ops.push(`${table}:release`);
            resolve({ error: null });
          },
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
  return { db, row, ops };
}

describe("claim-then-send", () => {
  it("of two concurrent claims exactly one wins", async () => {
    const t = fakeOrders(null);
    const results = [await claimConfirmation(t.db, "o1", NOW), await claimConfirmation(t.db, "o1", NOW)];
    expect(results).toEqual([true, false]);
    expect(t.row.confirmation_emailed_at).toBe(NOW.toISOString());
  });

  it("an already-claimed order cannot be claimed", async () => {
    const t = fakeOrders(ago(1));
    expect(await claimConfirmation(t.db, "o1", NOW)).toBe(false);
  });

  it("releasing after a failed send clears the stamp so a retry can claim again", async () => {
    const t = fakeOrders(null);
    expect(await claimConfirmation(t.db, "o1", NOW)).toBe(true);
    await releaseConfirmation(t.db, "o1");
    expect(t.row.confirmation_emailed_at).toBeNull();
    expect(await claimConfirmation(t.db, "o1", NOW)).toBe(true);
  });
});
