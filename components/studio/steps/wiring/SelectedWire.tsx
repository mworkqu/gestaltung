"use client";

// The selected wire in words, under every wiring view (P5-17):
// "ESP32 brain board GPIO4 → Light + (yellow)" with its colour, "Show in code"
// and Clear. Ids (c3) only in Engineer view.

import { useTranslations } from "next-intl";
import { Code2, X } from "lucide-react";

import { partName, WIRE_HEX, WIRE_NAME, WIRE_OUTLINE, type Connection } from "@/lib/studio/connections";
import type { GetPart, Locale } from "@/lib/studio/netlist";
import { linkCls } from "../../ui";
import { useWiringViews } from "./views-context";

export function wireWords(c: Connection, getPart: GetPart, locale: Locale) {
  const from = `${partName(getPart(c.from.partId), locale, c.from.part)} ${c.from.label}`;
  const to = `${partName(getPart(c.to.partId), locale, c.to.part)} ${c.to.label}`;
  const via = c.viaPartId ? partName(getPart(c.viaPartId), locale, c.viaPart) : null;
  return { from, to, colour: WIRE_NAME[c.wireColour][locale], via };
}

export function WireSwatch({ c, size = 14 }: { c: Pick<Connection, "wireColour">; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: WIRE_HEX[c.wireColour],
        boxShadow: `inset 0 0 0 1.5px ${WIRE_OUTLINE[c.wireColour] ?? "rgba(0,0,0,0.15)"}`,
      }}
    />
  );
}

export function SelectedWire({ locale }: { locale: Locale }) {
  const t = useTranslations("Studio.views");
  const { activeId, byId, select, selectedId, showInCode, engineer, getPart } = useWiringViews();
  const c = activeId ? byId.get(activeId) : undefined;
  if (!c) return null;
  const w = wireWords(c, getPart, locale);
  return (
    <div
      className="tile flex flex-wrap items-center gap-x-3 gap-y-2 border-0 px-4 py-3"
      aria-live="polite"
      data-testid="studio-selected-wire"
      data-connection={c.id}
    >
      <WireSwatch c={c} size={16} />
      <p className="min-w-0 flex-1 text-sm font-semibold text-heading" dir="auto">
        {t("wireLabel", { from: w.from, to: w.to, colour: w.colour })}
        {engineer && <span className="ms-2 font-mono text-xs text-mutedtext">{c.id} · {c.net}</span>}
      </p>
      {showInCode && (
        <button type="button" className={linkCls} onClick={() => showInCode(c.id)} data-testid="studio-show-in-code">
          <Code2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t("showInCode")}
        </button>
      )}
      {selectedId === c.id && (
        <button type="button" className={linkCls} onClick={() => select(null)}>
          <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          {t("clearSelection")}
        </button>
      )}
    </div>
  );
}
