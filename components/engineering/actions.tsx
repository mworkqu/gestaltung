"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import type { StudioDoc } from "@/lib/studio/schema";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-panel px-5 text-sm font-semibold text-heading shadow-neu transition-colors hover:text-cobalt";

/** Firmware code with a copy button. */
export function CopyCode({ code }: { code: string }) {
  const t = useTranslations("Engineering");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code stays selectable */
    }
  }
  return (
    <div className="space-y-2">
      <pre className="tile max-h-96 overflow-auto text-xs leading-relaxed text-body" dir="ltr" tabIndex={0}>
        <code>{code}</code>
      </pre>
      <button type="button" onClick={copy} className={btn}>
        {copied ? t("copied") : t("copyCode")}
      </button>
    </div>
  );
}

/** The whole project document as a JSON file, built in the browser. */
export function DownloadJson({ doc, fileName }: { doc: StudioDoc; fileName: string }) {
  const t = useTranslations("Engineering");
  function download() {
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <button type="button" onClick={download} className={btn}>
      {t("downloadJson")}
    </button>
  );
}
