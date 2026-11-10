"use client";

import { useVideoOverride } from "@/components/cad-champions/content/content-overrides";
import { getVideoSlot, hasRealPlayer, type VideoKey, type VideoSlotDef } from "@/lib/cad-champions/videos/registry";
import { resolveSlotRef } from "@/lib/cad-champions/videos/slot-override";

/**
 * A registry video slot with the admin's override applied (cc_content_overrides
 * "video:<key>", migration 0085): the override id wins, else the registry.
 */
export function useVideoSlot(key: VideoKey): VideoSlotDef & { realPlayer: boolean } {
  const slot = getVideoSlot(key);
  const override = useVideoOverride(key);
  const ref = resolveSlotRef(slot, override);
  return { ...slot, ...ref, realPlayer: hasRealPlayer(ref) };
}
