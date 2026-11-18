"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";

const btn =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-borderstrong px-4 text-sm font-medium text-body hover:border-azure/40 hover:text-azure";

// Copy / download the OpenSCAD text the plugin attached. Labels come from the
// server page (Leads namespace), so this needs no message scope.
export function PluginHandoffButtons({
  code,
  fileName,
  labels,
}: {
  code: string;
  fileName: string;
  labels: { copy: string; copied: string; download: string };
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the download button still works.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void copy()} className={btn}>
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? labels.copied : labels.copy}
      </button>
      <button type="button" onClick={download} className={btn}>
        <Download className="h-4 w-4" aria-hidden />
        {labels.download}
      </button>
    </div>
  );
}
