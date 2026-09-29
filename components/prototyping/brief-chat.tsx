"use client";

// "Help me describe it" (owner, 2026-09-29): a small chat that asks one plain
// question at a time about the idea, then offers a paragraph to add to the
// brief. Nothing is added until the client presses "Add to my brief".
// Messages can be read out loud. Sending anything needs the same consent as
// analysing the brief (audit #10); ticking it here records it for both.

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, MessageCircleQuestion, Plus, Send, X } from "lucide-react";

import { PrimaryButton, SoftButton } from "@/components/prototyping/ui";
import { ReadAloud } from "@/components/prototyping/read-aloud";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; text: string };

export function BriefChat({
  projectId,
  brief,
  destination,
  consented,
  onConsent,
  onAdd,
}: {
  projectId: string;
  brief: string;
  /** Where messages go (the AI provider's public name); null = chat unavailable. */
  destination: string | null;
  consented: boolean;
  onConsent: () => void;
  onAdd: (text: string) => Promise<void>;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [addition, setAddition] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);
  const [ticked, setTicked] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, busy, addition]);

  if (!destination) return null;

  async function send(next: Msg[]) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/brief-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, locale, brief, messages: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; done?: boolean; addition?: string; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error ?? "failed");
      setMsgs([...next, { role: "assistant", text: data.reply }]);
      if (data.done && data.addition) setAddition(data.addition);
    } catch {
      setError(true);
    }
    setBusy(false);
  }

  function start() {
    if (!consented) {
      if (!ticked) return;
      onConsent();
    }
    void send([]);
  }

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", text }];
    setMsgs(next);
    void send(next);
  }

  function reset() {
    setMsgs([]);
    setAddition(null);
    setAdded(false);
    setError(false);
  }

  return (
    <>
      <SoftButton onClick={() => setOpen(true)}>
        <MessageCircleQuestion className="h-3.5 w-3.5" />
        {t("chatOpen")}
      </SoftButton>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("chatTitle")}>
          <div className="neu flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-b-none sm:rounded-b-[1.25rem]">
            <div className="flex items-center justify-between gap-2 border-b border-borderstrong/40 px-4 py-3">
              <div>
                <p className="text-sm font-bold text-heading">{t("chatTitle")}</p>
                <p className="text-[11px] text-mutedtext">{t("chatIntro")}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("chatClose")} className="rounded-md p-1 text-mutedtext hover:text-heading">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {msgs.length === 0 && !busy ? (
                <div className="space-y-3">
                  <p className="text-sm text-body">{t("chatWelcome")}</p>
                  {!consented && (
                    <label className="flex items-start gap-2 text-[12px] leading-relaxed text-heading">
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={(e) => setTicked(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cobalt"
                      />
                      {t("aiConsentLabel", { destination })}
                    </label>
                  )}
                  <PrimaryButton onClick={start} disabled={!consented && !ticked}>
                    {t("chatStart")}
                  </PrimaryButton>
                </div>
              ) : (
                msgs.map((m, i) => (
                  <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[85%] space-y-1 rounded-2xl px-3 py-2 text-sm",
                        m.role === "user" ? "bg-cobalt text-white" : "bg-panel text-heading shadow-neu-sm"
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {m.role === "assistant" && <ReadAloud text={m.text} className="shadow-none" />}
                    </div>
                  </div>
                ))
              )}
              {busy && (
                <p className="flex items-center gap-2 text-[12px] text-mutedtext">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("chatThinking")}
                </p>
              )}
              {error && <p className="text-[12px] font-medium text-destructive">{t("chatFailed")}</p>}
              {addition && (
                <div className="space-y-2 rounded-xl border-s-4 border-emerald-500 bg-emerald-50/60 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{t("chatAddition")}</p>
                  <p className="whitespace-pre-wrap text-sm text-heading">{addition}</p>
                  {added ? (
                    <p className="text-[12px] font-semibold text-emerald-700">{t("chatAdded")}</p>
                  ) : (
                    <PrimaryButton
                      onClick={async () => {
                        await onAdd(addition);
                        setAdded(true);
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t("chatAddToBrief")}
                    </PrimaryButton>
                  )}
                </div>
              )}
              <div ref={endRef} />
            </div>

            {msgs.length > 0 && (
              <div className="flex items-center gap-2 border-t border-borderstrong/40 px-3 py-3">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={t("chatPlaceholder")}
                  aria-label={t("chatPlaceholder")}
                  disabled={busy}
                  className="min-w-0 flex-1 rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none placeholder:text-faint"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy || !input.trim()}
                  aria-label={t("chatSend")}
                  className="grid h-9 w-9 place-items-center rounded-xl bg-cobalt text-white disabled:opacity-50"
                >
                  <Send className={cn("h-4 w-4", locale === "ar" && "-scale-x-100")} />
                </button>
                <button type="button" onClick={reset} className="text-[11px] font-semibold text-mutedtext hover:text-heading">
                  {t("chatRestart")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
