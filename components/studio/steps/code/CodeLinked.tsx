"use client";

// The parts of the Code step that need the wire list (P5-17): pin-block sync with the
// "Pins updated" diff, line links, "Show in code" highlighting, the code lines and the
// Wokwi export. Loaded on demand from CodeStep so the Studio's first load stays small.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, X } from "lucide-react";

import { useStudioLibrary } from "../../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioDoc } from "@/lib/studio/schema";
import { linkCls, Problem } from "../../ui";
import { buildConnections, pinConstants } from "@/lib/studio/connections";
import { focusLines, lineLinks, pinDiffLines, syncPinBlock, type DiffLine } from "@/lib/studio/code-link";
import type { WokwiResult } from "@/lib/studio/wokwi";
import { CodeLines } from "./CodeLines";

const accent = STEP_ACCENT.code;

export default function CodeLinked({
  doc,
  firmware,
  writing,
  locale,
  onFirmware,
  focusId,
  onShowInWiring,
}: {
  doc: StudioDoc;
  firmware: { board: string; code: string };
  writing: boolean;
  locale: "en" | "ar";
  onFirmware: (firmware: { board: string; code: string }, serverVersion: number | null) => void;
  focusId?: string | null;
  onShowInWiring?: (id: string) => void;
}) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const tv = useTranslations("Studio.views");
  const wired = doc.netlist.nets.length > 0 && doc.checks.length > 0;

  // P5-17: the wires and their pin constants, from the same netlist as every wiring view.
  const connections = useMemo(
    () => (wired ? buildConnections(doc.components, doc.netlist.nets, getPart) : []),
    [wired, doc.components, doc.netlist.nets, getPart],
  );
  const byId = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);
  const constants = useMemo(() => pinConstants(connections, getPart), [connections, getPart]);
  const code = firmware?.code ?? "";
  const links = useMemo(() => lineLinks(code, constants), [code, constants]);

  // "Pins updated": the wiring changed but the board did not (the shell kept the code).
  // Only the pin block is replaced — free, no AI — and the client's own edits stay.
  const [pinDiff, setPinDiff] = useState<DiffLine[] | null>(null);
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (writing) return;
    const key = `${firmware.code}\u0000${JSON.stringify(constants)}`;
    if (synced.current === key) return;
    synced.current = key;
    const r = syncPinBlock(firmware.code, connections, getPart);
    if (!r.changed) return;
    setPinDiff(pinDiffLines(r.removed, r.added));
    onFirmware({ board: firmware.board, code: r.code }, null);
  }, [firmware, connections, constants, getPart, onFirmware, writing]);

  // "Show in code": highlight every line of that wire for a few seconds.
  const [focus, setFocus] = useState<{ id: string; lines: number[]; faded?: boolean } | null>(null);
  useEffect(() => {
    if (!focusId || !code) return;
    const lines = focusLines(code, focusId, constants);
    setFocus({ id: focusId, lines });
    if (!lines.length) return; // power / ground: the note stays until another wire is picked
    const first = lines[0];
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="studio-code-line"][data-line="${first + 1}"]`);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    });
    const timer = setTimeout(() => setFocus((f) => (f && f.id === focusId ? { ...f, lines: [], faded: true } : f)), 4000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request / code
  }, [focusId, code]);
  const highlight = useMemo(() => new Set(focus?.lines ?? []), [focus]);
  const powerNote =
    !!focus && !focus.faded && focus.lines.length === 0 && !!byId.get(focus.id) && !constants.some((c) => c.connectionIds.includes(focus.id));

  // Wokwi export: worked out on demand (module loaded after the code shows), hidden when unsupported.
  const [wokwi, setWokwi] = useState<WokwiResult | null>(null);
  const [wokwiFailed, setWokwiFailed] = useState(false);
  useEffect(() => {
    if (!connections.length) {
      setWokwi(null);
      return;
    }
    let live = true;
    void import("@/lib/studio/wokwi")
      .then((m) => {
        if (live) setWokwi(m.wokwiDiagram(doc.components, connections, doc.netlist.nets, getPart));
      })
      .catch(() => {
        if (live) setWokwi(null);
      });
    return () => {
      live = false;
    };
  }, [firmware, connections, doc.components, doc.netlist.nets, getPart]);

  async function downloadWokwi() {
    if (!wokwi?.ok) return;
    setWokwiFailed(false);
    try {
      const [{ wokwiFiles }, { zipStore }] = await Promise.all([import("@/lib/studio/wokwi"), import("@/lib/studio/zip")]);
      const bytes = zipStore(wokwiFiles(wokwi.diagram, firmware.code));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      const slug = (doc.spec.name || "project").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "project";
      a.href = url;
      a.download = `${slug}-wokwi.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setWokwiFailed(true);
    }
  }

  return (
    <>
          {pinDiff && (
            <div className="tile space-y-2 border-0 p-4" role="status" data-testid="studio-pins-updated" style={{ background: accent.soft }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-heading">{tv("code.pinsUpdated")}</p>
                  <p className="text-sm text-body">{tv("code.pinsUpdatedText")}</p>
                </div>
                <button
                  type="button"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mutedtext hover:text-heading"
                  onClick={() => setPinDiff(null)}
                  aria-label={tv("code.dismiss")}
                >
                  <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
              {pinDiff.length > 0 && (
                <ul dir="ltr" className="overflow-x-auto rounded-xl bg-[#1c2434] px-3 py-2 text-start font-mono text-xs leading-relaxed">
                  {pinDiff.map((d, i) => (
                    <li key={i} className={d.kind === "removed" ? "whitespace-pre text-[#fca5a5] line-through" : "whitespace-pre text-[#86efac]"}>
                      <span className="sr-only">{d.kind === "removed" ? tv("code.removed") : tv("code.added")}: </span>
                      {d.kind === "removed" ? "− " : "+ "}
                      {d.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {powerNote && (
            <p className="text-sm font-medium" style={{ color: accent.ink }} role="status" data-testid="studio-code-power-note">
              {tv("code.powerWire")}
            </p>
          )}
          <CodeLines
            code={firmware.code}
            links={links}
            byId={byId}
            getPart={getPart}
            locale={locale}
            highlight={highlight}
            onShowInWiring={onShowInWiring}
            label={t("title_code")}
          />
          {wokwi?.ok && (
            <div className="space-y-1">
              <button type="button" className={linkCls} onClick={() => void downloadWokwi()} data-testid="studio-wokwi">
                <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                {tv("wokwi.download")}
              </button>
              <p className="ps-2 text-xs text-mutedtext">{tv("wokwi.guide")}</p>
              {wokwiFailed && <Problem>{tv("wokwi.failed")}</Problem>}
            </div>
          )}
    </>
  );
}
