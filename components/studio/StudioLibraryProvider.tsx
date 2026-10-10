"use client";

// The Studio's part library in the browser (P5-15c): the code library plus the
// owner's studio_parts edits, which the Studio page reads on the server
// (lib/studio/library/remote.ts, already validated) and passes down as
// `overrides`. Steps look parts up through useStudioLibrary(); the provider
// also registers the merged list for code that still calls the module-level
// getPart() (the 3D viewer). No provider (the e2e fixture) = code library.

import { createContext, useContext, useMemo } from "react";

import { CODE_LIBRARY, LIBRARY, makeLibrary, setClientLibrary, type StudioLibrary } from "@/lib/studio/library";
import type { LibraryPart } from "@/lib/studio/schema";

const Ctx = createContext<StudioLibrary>(CODE_LIBRARY);

/** Code parts with same-id overrides replaced, then the new parts (same order as mergeLibrary). */
export function withOverrides(overrides: LibraryPart[]): LibraryPart[] {
  if (!overrides.length) return LIBRARY;
  const byId = new Map(overrides.map((p) => [p.id, p]));
  const codeIds = new Set(LIBRARY.map((p) => p.id));
  return [...LIBRARY.map((p) => byId.get(p.id) ?? p), ...overrides.filter((p) => !codeIds.has(p.id))];
}

export function StudioLibraryProvider({
  overrides,
  children,
}: {
  overrides?: LibraryPart[];
  children: React.ReactNode;
}) {
  const lib = useMemo(() => {
    const list = overrides?.length ? withOverrides(overrides) : null;
    // Browser only (no-op on the server); idempotent, so calling during render is safe.
    setClientLibrary(list);
    return list ? makeLibrary(list) : CODE_LIBRARY;
  }, [overrides]);
  return <Ctx.Provider value={lib}>{children}</Ctx.Provider>;
}

export function useStudioLibrary(): StudioLibrary {
  return useContext(Ctx);
}
