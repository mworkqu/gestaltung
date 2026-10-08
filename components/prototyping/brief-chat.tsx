"use client";

// "Help me describe it" (owner, 2026-09-29): a small chat that asks one plain
// question at a time about the idea, then offers a paragraph to add to the
// brief. Nothing is added until the client presses "Add to my brief".
// Messages can be read out loud. Sending anything needs the same consent as
// analysing the brief (audit #10); ticking it here records it for both.
//
// Direct-to-AI creation (P1-11 / CC-1): a project started from "Describe your
// idea" opens here with ?start=chat. `initialOpen` reads the first turn the
// new-project page left in sessionStorage (removed at once), opens the chat
// with that history and carries on from it — no new first question.

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircleQuestion, Plus, X } from "lucide-react";

import { PrimaryButton, SoftButton } from "@/components/prototyping/ui";
import { ChatConsent, ChatInput, ChatMessages } from "@/components/prototyping/chat-thread";
import { chatStorageKey, parseHandoff, type ChatHandoff, type ChatMsg } from "@/lib/projects/create-from-chat";

type Msg = ChatMsg;

/** Reads and removes the first-turn handoff; null when absent or storage is blocked. */
function takeHandoff(projectId: string): ChatHandoff | null {
  try {
    const key = chatStorageKey(projectId);
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return parseHandoff(raw);
  } catch {
    return null;
  }
}

export function BriefChat({
  projectId,
  brief,
  destination,
  consented,
  onConsent,
  onAdd,
  initialOpen = false,
  initialThread,
}: {
  projectId: string;
  brief: string;
  /** Where messages go (the AI provider's public name); null = chat unavailable. */
  destination: string | null;
  consented: boolean;
  onConsent: () => void;
  onAdd: (text: string) => Promise<void>;
  /** Open on mount with the stored first turn (?start=chat). */
  initialOpen?: boolean;
  /** The first turn, when the caller already has it (else read from sessionStorage). */
  initialThread?: ChatHandoff | null;
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
  // StrictMode runs effects twice; the handoff is read (and removed) once.
  const took = useRef(false);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, busy, addition]);

  useEffect(() => {
    if (!initialOpen || took.current || !destination) return;
    took.current = true;
    const thread = initialThread ?? takeHandoff(projectId);
    if (!thread) return;
    setMsgs(thread.messages);
    setAddition(thread.addition);
    setError(Boolean(thread.error));
    setOpen(true);
  }, [initialOpen, initialThread, projectId, destination]);

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
              {msgs.length === 0 && !busy && (
                <div className="space-y-3">
                  <p className="text-sm text-body">{t("chatWelcome")}</p>
                  {!consented && <ChatConsent destination={destination} checked={ticked} onChange={setTicked} id="brief-chat-consent" />}
                  <PrimaryButton onClick={start} disabled={!consented && !ticked}>
                    {t("chatStart")}
                  </PrimaryButton>
                </div>
              )}
              <ChatMessages msgs={msgs} busy={busy} error={error} />
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
              <ChatInput
                value={input}
                onChange={setInput}
                onSubmit={submit}
                busy={busy}
                className="border-t border-borderstrong/40 px-3 py-3"
              >
                <button type="button" onClick={reset} className="text-[11px] font-semibold text-mutedtext hover:text-heading">
                  {t("chatRestart")}
                </button>
              </ChatInput>
            )}
          </div>
        </div>
      )}
    </>
  );
}
