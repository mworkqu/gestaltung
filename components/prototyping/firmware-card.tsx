"use client";

// Software › Code (owner, 2026-09-29). One button writes a starter Arduino /
// ESP32 sketch for this project's own circuit; copy it or download the .ino,
// with the libraries to install and how to upload. Needs the circuit first
// (Electronics › Components).

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Code2, Copy, Download, Loader2, RefreshCw } from "lucide-react";

import { Card, PrimaryButton, SoftButton, Warn } from "@/components/prototyping/ui";
import type { Firmware } from "@/lib/prototyping/firmware";

export function FirmwareCard({
  projectId,
  firmware,
  hasCircuit,
  onGoCircuit,
  onSaved,
}: {
  projectId: string;
  firmware: Firmware | null;
  hasCircuit: boolean;
  onGoCircuit: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<Firmware | null>(null);
  const [copied, setCopied] = useState(false);
  const fw = local ?? firmware;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/firmware", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, locale }),
      });
      const data = (await res.json().catch(() => ({}))) as { firmware?: Firmware; saved?: boolean; error?: string };
      if (!res.ok || !data.firmware) setError(data.error ?? "failed");
      else {
        setLocal(data.firmware);
        if (data.saved) await onSaved();
      }
    } catch {
      setError("failed");
    }
    setBusy(false);
  }

  function download() {
    if (!fw) return;
    const url = URL.createObjectURL(new Blob([fw.code], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fw.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card kicker={t("discipline_software")} title={t("fwTitle")} intro={t("fwIntro")}>
      {!hasCircuit ? (
        <div className="space-y-2">
          <p className="text-sm text-mutedtext">{t("fwNeedsCircuit")}</p>
          <SoftButton onClick={onGoCircuit}>{t("fwGoCircuit")}</SoftButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {fw ? (
            <SoftButton onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {busy ? t("fwWriting") : t("fwRewrite")}
            </SoftButton>
          ) : (
            <PrimaryButton onClick={generate} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
              {busy ? t("fwWriting") : t("fwWrite")}
            </PrimaryButton>
          )}
          {busy && <span className="text-[11.5px] text-mutedtext">{t("fwWritingNote")}</span>}
        </div>
      )}

      {error && <Warn blocking>{t(`fwErr_${["no_controller", "paused", "no_circuit"].includes(error) ? error : "failed"}`)}</Warn>}

      {fw && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {fw.board && (
              <span className="rounded-full bg-panel px-3 py-1 text-[12px] font-semibold text-heading shadow-neu-sm">
                {t("fwBoard")}: <span dir="ltr">{fw.board}</span>
              </span>
            )}
            <SoftButton
              onClick={() =>
                navigator.clipboard?.writeText(fw.code).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("fwCopied") : t("fwCopy")}
            </SoftButton>
            <SoftButton onClick={download}>
              <Download className="h-3.5 w-3.5" />
              {t("fwDownload", { file: fw.fileName })}
            </SoftButton>
          </div>

          <pre dir="ltr" className="max-h-[480px] overflow-auto rounded-xl bg-ink p-4 text-[12px] leading-relaxed text-white/90">
            <code>{fw.code}</code>
          </pre>

          {fw.libraries.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-heading">{t("fwLibraries")}</p>
              <ul className="space-y-0.5 text-[12.5px] text-body">
                {fw.libraries.map((l) => (
                  <li key={l.name}>
                    <span className="font-mono font-semibold text-heading" dir="ltr">
                      {l.name}
                    </span>{" "}
                    — {l.why}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fw.steps.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-bold text-heading">{t("fwSteps")}</p>
              <ol className="list-decimal space-y-0.5 ps-5 text-[12.5px] text-body">
                {fw.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}
          {fw.notes.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-[12px] text-mutedtext">
              {fw.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-faint">{t("fwDisclaimer")}</p>
        </div>
      )}
    </Card>
  );
}
