// Client view or Engineer view (P5-04). Every non-admin gets the client view.
// A super_admin gets a toggle and the choice is remembered per browser
// (localStorage, always wrapped in try/catch by the caller). With no saved
// choice an admin opens the Engineer view, as before.

export type ViewMode = "client" | "engineer";

export const VIEW_MODE_KEY = "gestaltung:proto-view";

export function parseViewMode(raw: string | null | undefined): ViewMode | null {
  return raw === "client" || raw === "engineer" ? raw : null;
}

/** The mode to show: non-admins always see the client view; admins see their saved choice, else Engineer. */
export function resolveViewMode({ isAdmin, saved }: { isAdmin: boolean; saved: ViewMode | null }): ViewMode {
  if (!isAdmin) return "client";
  return saved ?? "engineer";
}
