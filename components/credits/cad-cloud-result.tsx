"use client";

// A model built by the cloud engine (CadQuery worker). Client view, kept
// simple: the preview image, the outside size, ONE plain check line, two
// downloads (STL for 3D printing, STEP for CAD) and "Get it made". No code,
// no log, no check names. The engineer view (super_admin) adds the code, the
// worker log and every check. Presentational: data and the download action
// come from the caller (components/credits/cad-card.tsx).

import { useTranslations } from "next-intl";
import { Check, Download, Factory, X } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SoftButton } from "@/components/prototyping/ui";
import { clientCheckSummary, type CloudManifest } from "@/lib/cad/engine";
import { cn } from "@/lib/utils";

const mm = (n: number) => n.toFixed(1);

export function CadCloudResult({
  manifest,
  previewUrl,
  onDownload,
  engineer = false,
  code,
  summary,
  busy = false,
}: {
  manifest: CloudManifest;
  /** Signed URL of the worker's SVG preview; null while it loads or when it is missing. */
  previewUrl: string | null;
  onDownload: (kind: "stl" | "step") => void;
  engineer?: boolean;
  code?: string | null;
  summary?: string | null;
  busy?: boolean;
}) {
  const t = useTranslations("Credits");
  const check = clientCheckSummary(manifest);
  const wall = mm(check.wallMm).replace(/\.0$/, "");
  const checkLine = !check.allPass
    ? t("cadCloudCheckReview")
    : check.fits === true
      ? t("cadCloudCheckFits", { wall })
      : t("cadCloudCheckWalls", { wall });

  return (
    <div className="space-y-3" data-testid="cad-cloud-result">
      <div className="neu-inset flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-panel sm:aspect-[16/9]">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL; an <img> never runs SVG scripts
          <img src={previewUrl} alt={t("cadCloudPreviewAlt")} className="h-full w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-mutedtext">{t("cadCloudPreviewAlt")}</span>
        )}
      </div>

      {manifest.bbox && (
        <p className="text-sm font-semibold text-heading">
          <span dir="ltr" className="font-mono">
            {t("cadCloudSize", { x: mm(manifest.bbox.x), y: mm(manifest.bbox.y), z: mm(manifest.bbox.z) })}
          </span>
        </p>
      )}
      <p
        className={cn(
          "flex items-start gap-1.5 text-sm",
          check.allPass ? "text-buy" : "text-mutedtext"
        )}
      >
        {check.allPass && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
        {checkLine}
      </p>
      {summary && <p className="text-sm text-body">{summary}</p>}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <SoftButton onClick={() => onDownload("stl")} disabled={busy} className="justify-center max-sm:w-full">
          <Download className="h-3.5 w-3.5" />
          {t("cadDownloadStlPrint")}
        </SoftButton>
        <SoftButton onClick={() => onDownload("step")} disabled={busy} className="justify-center max-sm:w-full">
          <Download className="h-3.5 w-3.5" />
          {t("cadDownloadStep")}
        </SoftButton>
        <Link
          href="/design/quote"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover max-md:min-h-11 max-sm:w-full"
        >
          <Factory className="h-3.5 w-3.5" />
          {t("cadGetMade")}
        </Link>
      </div>

      {engineer && (
        <div className="space-y-2 rounded-xl bg-panel px-4 py-3 text-xs shadow-neu-inset" data-testid="cad-engineer">
          <p className="font-semibold text-heading">{t("cadEngChecks")}</p>
          {manifest.checks.length === 0 ? (
            <p className="text-mutedtext">—</p>
          ) : (
            <ul className="space-y-1" dir="ltr">
              {manifest.checks.map((c, i) => (
                <li key={`${c.name}-${i}`} className="flex items-start gap-1.5 font-mono text-[11px]">
                  {c.pass ? (
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-buy" aria-label={t("cadEngPass")} />
                  ) : (
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-label={t("cadEngFail")} />
                  )}
                  <span className="font-semibold">{c.name}</span>
                  <span className="min-w-0 break-words text-mutedtext">{c.detail}</span>
                </li>
              ))}
            </ul>
          )}
          {manifest.volumeMm3 != null && (
            <p className="text-mutedtext" dir="ltr">
              {t("cadEngVolume", { v: Math.round(manifest.volumeMm3).toString() })}
            </p>
          )}
          {code && (
            <details>
              <summary className="cursor-pointer font-semibold text-heading">{t("cadEngCode")}</summary>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre font-mono text-[10.5px]" dir="ltr">
                {code}
              </pre>
            </details>
          )}
          {manifest.log && (
            <details>
              <summary className="cursor-pointer font-semibold text-heading">{t("cadEngLog")}</summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[10.5px]" dir="ltr">
                {manifest.log.slice(-6000)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
