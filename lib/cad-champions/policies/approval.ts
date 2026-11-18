// Policy approval switch (pure). The privacy / terms / refunds pages show a
// "DRAFT, not yet approved" banner until an admin sets the override
// cc_content_overrides key "flag:policies.approved" to "1" (Admin > Landing
// page > Legal pages). Missing table, missing row or any other value = draft.

export const POLICIES_APPROVED_KEY = "flag:policies.approved";

/** True only when the override map holds exactly "1" (trimmed) for the approval key. */
export function arePoliciesApproved(map: ReadonlyMap<string, string> | null | undefined): boolean {
  return map?.get(POLICIES_APPROVED_KEY)?.trim() === "1";
}
