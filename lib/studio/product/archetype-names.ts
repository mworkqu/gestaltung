// Archetype names: a dependency-free leaf so lib/studio/schema.ts can use the
// type without importing product/schema.ts (which imports back into schema.ts).

export const ARCHETYPES = [
  "stake_device", "planter_insert", "desk_object", "lamp", "wall_mount", "handheld",
  "wearable_band", "pet_feeder", "dispenser", "vehicle_mount", "outdoor_box", "tabletop_robot",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];
