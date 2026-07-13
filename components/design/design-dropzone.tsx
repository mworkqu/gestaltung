"use client";

import { useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { UploadCloud, ArrowUpRight } from "lucide-react";

import { useRouter, Link } from "@/i18n/navigation";
import { GMark } from "@/components/g-mark";
import { setPendingUpload } from "@/lib/design/pending-upload";
import { ACCEPT_ATTR, ACCEPT_EXTENSIONS } from "@/lib/jobs/constants";
import { cn } from "@/lib/utils";

function extOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

// The homepage "custom manufacturing" panel, now an interactive drag-and-drop
// zone. Picking or dropping a CAD file carries it to the public /design/quote
// page (email/phone + method), keeping the blueprint aesthetic of the old box.
export function DesignDropzone() {
  const t = useTranslations("StoreLanding");
  const locale = useLocale();
  const router = useRouter();
  const isRtl = locale === "ar";
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  function accept(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT_EXTENSIONS.includes(extOf(file.name))) {
      setError(t("dropError"));
      return;
    }
    setError(null);
    setPendingUpload(file);
    router.push("/design/quote");
  }

  return (
    <div className="flex flex-col justify-between gap-6">
      <div className={mono("flex items-center justify-between text-[10px] text-faint")}>
        <span>{t("customKicker")}</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> FIG·01
        </span>
      </div>

      {/* Drop / browse well */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        aria-label={t("dropCta")}
        className={cn(
          "neu-inset relative flex min-h-[15rem] flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden p-8 text-center transition",
          dragging && "ring-2 ring-cobalt/60"
        )}
      >
        <div aria-hidden className="bg-blueprint-grid absolute inset-0 opacity-70" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-50"
        >
          <span className="absolute h-36 w-36 rounded-full border border-borderstrong" />
          <span className="absolute h-52 w-52 rounded-full border border-dashed border-borderstrong/70" />
        </div>

        <div className="relative flex flex-col items-center">
          <GMark className="h-16 w-16" />
          <p className={mono("mt-3 text-[10px] text-faint")}>STL · STEP · DXF · IGES</p>

          <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-heading">
            <UploadCloud className="h-4 w-4 text-cobalt" strokeWidth={1.75} />
            {t("dropCta")}
          </span>
          <span className="mt-1 text-xs text-cobalt">{t("dropBrowse")}</span>
          <span className="mt-3 text-[10px] text-faint">{t("dropHint")}</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = "";
          }}
          className="sr-only"
        />
      </button>

      <div className="space-y-3">
        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : (
          <p className="text-sm leading-relaxed text-body">{t("dropText")}</p>
        )}
        <Link
          href="/design"
          className="inline-flex items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          {t("dropExplore")}
          <ArrowUpRight className={cn("h-4 w-4", isRtl && "-scale-x-100")} />
        </Link>
      </div>
    </div>
  );
}
