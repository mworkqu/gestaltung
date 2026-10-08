"use client";

// "Describe your idea" (P1-11 / CC-1, 2026-10-08): /projects/new opens a chat,
// not a form. Nothing is saved until the first message is sent; then, in this
// order:
//   1. ensureSession() — the anonymous session is minted at the first write;
//   2. one projects insert: name "New project", brief = the message, and the
//      AI consent in spec.aiConsent (so the provider never gets text before a
//      consent record exists);
//   3. the first /api/brief-chat turn;
//   4. the turn (or its failure) goes to sessionStorage and the workspace
//      opens with ?start=chat, where BriefChat picks it up and carries on.
// The 3-active-projects cap (0042) stops at step 2 with a link to archive one.

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { ChatConsent, ChatInput, ChatMessages } from "@/components/prototyping/chat-thread";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import {
  buildFirstTurn,
  buildHandoff,
  chatStorageKey,
  isProjectLimitError,
  newProjectInsert,
  type ChatMsg,
} from "@/lib/projects/create-from-chat";

export function NewProjectChat({ destination }: { destination: string }) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const router = useRouter();

  const [input, setInput] = useState("");
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [limit, setLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const first: ChatMsg = { role: "assistant", text: t("chatFirst") };
  const msgs: ChatMsg[] = sent ? [first, { role: "user", text: sent }] : [first];

  async function start() {
    const text = input.trim();
    if (!text || !ticked || busy) return;
    setBusy(true);
    setError(null);
    setLimit(false);
    setSent(text);

    let projectId: string;
    try {
      const user = await ensureSession();
      const { data, error: insertError } = await createClient()
        .from("projects")
        .insert(newProjectInsert({ userId: user.id, text, destination, now: new Date() }))
        .select("id")
        .single();
      if (insertError) throw insertError;
      projectId = data.id as string;
    } catch (err) {
      const message = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
      if (isProjectLimitError(message)) setLimit(true);
      else setError(message);
      setSent(null);
      setBusy(false);
      return;
    }

    let reply: string | null = null;
    let addition: string | null = null;
    let done = false;
    let errorCode: string | null = null;
    try {
      const res = await fetch("/api/brief-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, locale, brief: "", messages: buildFirstTurn(text) }),
      });
      const data = (await res.json().catch(() => ({}))) as { reply?: string; done?: boolean; addition?: string; error?: string };
      if (!res.ok || !data.reply) errorCode = data.error ?? "failed";
      else {
        reply = data.reply;
        done = Boolean(data.done);
        addition = data.done && data.addition ? data.addition : null;
      }
    } catch {
      errorCode = "failed";
    }

    try {
      sessionStorage.setItem(
        chatStorageKey(projectId),
        JSON.stringify(buildHandoff({ text, reply, addition, done, error: errorCode }))
      );
    } catch {
      // Storage blocked: the workspace opens on the brief without the chat.
    }
    // refresh() so the server sees the session cookie the anonymous sign-in
    // just wrote, before the workspace renders.
    router.replace(`/projects/${projectId}/prototyping?start=chat`);
    router.refresh();
  }

  return (
    <div className="neu space-y-4 p-5 sm:p-6">
      <div className="space-y-3">
        <ChatMessages msgs={msgs} busy={busy} error={false} />
      </div>

      {limit && (
        <p className="text-sm font-medium text-destructive">
          {t("limitReached")}{" "}
          <Link href="/projects" className="font-semibold text-cobalt underline-offset-2 hover:underline">
            {t("limitArchiveLink")}
          </Link>
        </p>
      )}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={() => void start()}
        busy={busy}
        canSend={ticked}
        sendText={t("chatStartButton")}
        placeholder={t("emptyExample")}
        autoFocus
      />
      <ChatConsent destination={destination} checked={ticked} onChange={setTicked} disabled={busy} withHint id="new-project-consent" />
    </div>
  );
}
