"use client";

import * as React from "react";

import type { ClientOverrides } from "@/lib/cad-champions/content/overrides";

// Client side of cc_content_overrides (migration 0085): the CC layout reads
// the overrides of the page locale on the server and passes the video and
// glossary ones here. Message overrides (msg:*) are already merged into the
// NextIntlClientProvider messages by the layout, so useTranslations sees them.

const EMPTY: ClientOverrides = { videos: {}, glossary: {} };

const Ctx = React.createContext<ClientOverrides>(EMPTY);

export function CcContentOverridesProvider({ value, children }: { value: ClientOverrides | null; children: React.ReactNode }) {
  return <Ctx.Provider value={value ?? EMPTY}>{children}</Ctx.Provider>;
}

/** Stored video value ("youtube:<id>" or a Bunny GUID) for a registry slot, or null. */
export function useVideoOverride(slotKey: string): string | null {
  return React.useContext(Ctx).videos[slotKey] ?? null;
}

/** Admin-edited glossary term/definition for an id (each field optional). */
export function useGlossaryOverride(id: string): { term?: string; definition?: string } | null {
  return React.useContext(Ctx).glossary[id] ?? null;
}
