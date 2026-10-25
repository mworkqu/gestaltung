// Design Studio data formats — the single source of truth (all units mm, Z up).
//
// Two layers:
//  * zod schemas describe a VALID document (what we store in projects.studio
//    and what the renderer accepts);
//  * clamp*() helpers turn ANY value (usually AI JSON) into a valid one: bad
//    enums fall back to safe defaults, numbers are clamped to their ranges, and
//    every change is recorded in a ClampLog for admin (never shown to clients).
//
// The AI never writes geometry: it only fills these small objects. The same
// JSON is meant to feed a future CadQuery backend unchanged (lib/studio/cad-adapter.ts).

//
// Split by responsibility (R8); this file is the stable import path:
//   schema-enums.ts     enum lists, derived types, LIMITS
//   schema-zod.ts       zod schemas + inferred types
//   schema-defaults.ts  defaults, fixed tables, emptyStudioDoc / parseStudioDoc
//   schema-clamp.ts     clamp*() helpers and ClampLog

export * from "./schema-enums";
export * from "./schema-zod";
export * from "./schema-defaults";
export * from "./schema-clamp";
