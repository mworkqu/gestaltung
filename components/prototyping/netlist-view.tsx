"use client";

// The Electronics › Board circuit: one stored netlist, two views.
//
//   Wiring   — the customer view: each part is the actual store product its
//              BOM line matched, wired pin to pin. Clicking one opens its page.
//   Schematic — the engineering view: symbols, rails top and bottom.
//
// Both are regenerated from projects.netlist on every render; the netlist is
// the single source of truth. Electrical warnings come from our own checks
// (lib/prototyping/netlist sanityChecks), in words, naming the component.

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, Cpu, Loader2, RefreshCw } from "lucide-react";

import { Card, PrimaryButton, SoftButton, Warn } from "@/components/prototyping/ui";
import { SvgFrame } from "@/components/prototyping/svg-frame";
import { partImageUrl, partName } from "@/lib/parts/format";
import type { LineMatch, ProjectBom } from "@/lib/prototyping/bom";
import { sanityChecks, type Flag, type ProjectNetlist } from "@/lib/prototyping/netlist";
import { renderSchematic } from "@/lib/prototyping/schematic-svg";
import { renderWiring, type WiringProduct } from "@/lib/prototyping/wiring-svg";
import { cn } from "@/lib/utils";

type ErrorCode = "paused" | "invalid" | "no_electronics" | "unavailable" | "rate_limited" | "not_ready" | "failed";

export function NetlistView({
  projectId,
  netlist,
  bom,
  matches,
  onSaved,
}: {
  projectId: string;
  netlist: ProjectNetlist | null;
  bom: ProjectBom | null;
  matches: Map<string, LineMatch>;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const [view, setView] = useState<"wiring" | "schematic">("wiring");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: ErrorCode; problems?: string[] } | null>(null);

  const hasElectronics = (bom?.lines ?? []).some((l) => l.kind === "electronics");
  const flags = useMemo(() => (netlist ? sanityChecks(netlist) : []), [netlist]);

  const svg = useMemo(() => {
    if (!netlist) return "";
    if (view === "schematic") return renderSchematic({ netlist, flags });
    const products = new Map<string, WiringProduct | null>();
    for (const l of bom?.lines ?? []) {
      const p = matches.get(l.id)?.product ?? null;
      products.set(
        l.id,
        p ? { name: partName(p, locale), href: `/${locale}/store/${encodeURIComponent(p.sku)}`, image: partImageUrl(p) } : null
      );
    }
    return renderWiring({ netlist, flags, products, labels: { noPhoto: t("noPhoto"), noProduct: t("wiringNoProduct") } });
  }, [netlist, view, flags, bom, matches, locale, t]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/netlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: ErrorCode; problems?: string[] };
      if (!res.ok) setError({ code: data.error ?? "failed", problems: data.problems });
      else await onSaved();
    } catch {
      setError({ code: "failed" });
    }
    setBusy(false);
  }

  const component = (ref: string) => netlist?.components.find((c) => c.ref === ref);
  const who = (ref: string) => {
    const c = component(ref);
    return c ? `${ref} (${c.function})` : ref;
  };
  const flagText = (f: Flag) =>
    f.code === "floating"
      ? t("flag_floating", { net: f.net, ref: f.ref ? who(f.ref) : "—" })
      : f.code === "unpowered"
        ? t("flag_unpowered", { ref: who(f.ref) })
        : f.code === "shorted"
          ? t("flag_shorted", { net: f.net, refs: f.refs.map(who).join(", ") })
          : t("flag_overcurrent", { rail: f.rail, draw: f.drawMa, max: f.maxMa, refs: f.refs.map(who).join(", ") });

  return (
    <Card
      kicker={t("discipline_electronics")}
      title={t("circuitTitle")}
      intro={t("circuitIntro")}
      actions={
        hasElectronics && (
          netlist ? (
            <SoftButton onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("circuitRegenerate")}
            </SoftButton>
          ) : (
            <PrimaryButton onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
              {busy ? t("circuitWorking") : t("circuitGenerate")}
            </PrimaryButton>
          )
        )
      }
    >
      {!hasElectronics && <p className="text-sm text-mutedtext">{t("circuitNeedsBom")}</p>}

      {error && (
        <Warn blocking>
          {t(`circuitErr_${error.code}`)}
          {error.problems?.length ? (
            <ul className="mt-1 list-disc ps-5 font-mono text-[10.5px] font-normal">
              {error.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </Warn>
      )}

      {netlist && (
        <>
          {flags.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-destructive/5 p-3" aria-label={t("circuitWarnings")}>
              {flags.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] font-medium text-destructive">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {flagText(f)}
                </li>
              ))}
            </ul>
          )}

          <div className="inline-flex rounded-lg bg-panel p-0.5 shadow-neu-inset" role="tablist">
            {(["wiring", "schematic"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  view === v ? "bg-surface text-heading shadow-neu-sm" : "text-mutedtext hover:text-heading"
                )}
              >
                {t(`circuitView_${v}`)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-mutedtext">{t(`circuitViewNote_${view}`)}</p>

          <SvgFrame svg={svg} fileName={`circuit-${view}`} title={t(`circuitView_${view}`)} />

          {netlist.notes.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-[12px] text-mutedtext">
              {netlist.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-[10.5px] text-faint">{t("circuitProvenance")}</p>
        </>
      )}
    </Card>
  );
}
