// Admin-edited intro video ids (cc_content_overrides "video:<slot key>").
// Pure: the override wins when it parses to a real video (YouTube id, Bunny
// GUID or file:<self-hosted id>); anything else (empty, malformed) falls back
// to the registry slot.

import { parseSlotVideo, type VideoRef } from "./registry";

export function resolveSlotRef(slot: VideoRef, override: string | null | undefined): VideoRef {
  if (override && override.trim() !== "") {
    const parsed = parseSlotVideo(override);
    if (parsed.provider !== "placeholder") return parsed;
  }
  return { provider: slot.provider, providerId: slot.providerId };
}
