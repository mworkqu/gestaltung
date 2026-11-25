/**
 * Where free meeting slots come from. One interface, one implementation today:
 * the owner's settings rules minus the slots already booked (migration 0113).
 *
 * The interface exists so a Google Calendar provider can be added later
 * WITHOUT touching the tools, the pages or the API routes — that provider is
 * deliberately not built yet. Pure: a provider is handed its data, it never
 * reaches for Supabase itself (lib/meetings/server.ts does that).
 */

import { freeSlots } from "./slots";
import type { MeetingSettings } from "./settings";

export interface AvailabilityProvider {
  /** Free slot start times as ISO instants, ordered, for `days` from `fromIso` (a Qatar date). */
  freeSlots(fromIso: string | undefined, days: number | undefined): Promise<string[]>;
}

export type SettingsAvailabilityDeps = {
  settings: MeetingSettings;
  /** Public holiday ISO dates (store_settings.holidays.dates). */
  holidays: readonly string[];
  /** Instants held by a live booking in the window asked for. */
  takenSlots(fromIso: string, days: number): Promise<readonly string[]>;
  now(): Date;
};

/** Today's provider: the settings calendar, minus live bookings. */
export function settingsAvailability(deps: SettingsAvailabilityDeps): AvailabilityProvider {
  return {
    async freeSlots(fromIso, days) {
      const nowMs = deps.now().getTime();
      const span = Math.min(Math.max(days ?? deps.settings.horizon_days, 1), deps.settings.horizon_days);
      // Ask the store for the same window we are about to generate.
      const from = fromIso ?? new Date(nowMs + 3 * 3_600_000).toISOString().slice(0, 10);
      const taken = await deps.takenSlots(from, span);
      return freeSlots({
        settings: deps.settings,
        fromIso: from,
        days: span,
        nowMs,
        holidays: deps.holidays,
        taken,
      });
    },
  };
}
