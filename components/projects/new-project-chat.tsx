"use client";

// "Describe your idea" (P1-11 / CC-1, 2026-10-08): /projects/new opens a chat,
// not a form. Nothing is saved until the first message is sent; then, in this
// order:
//   1. ensureSession() — the anonymous session is minted at the first write;
//   2. one projects insert: name "New project", brief = the message, and the
//      AI consent in spec.aiConsent (so the provider never gets text before a
//      consent record exists);
//   3. (P5-13) no AI call here: the Design Studio asks the first question;
//   4. the first message goes to sessionStorage and the Design Studio
//      opens with ?start=chat, where its idea chat picks it up and carries on.
// The 3-active-projects cap (0042) stops at step 2 with a link to archive one.
//
// Turnstile (P2-08): with the switch on and no session yet, the widget shows
// under the consent box and its token goes to ensureSession() (anonymous
// sign-in). Without an inline token ensureSession() asks the page's challenge
// dialog. Switch off = no widget, ensureSession() exactly as before.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Link, useRouter } from "@/i18n/navigation";
import { ChatConsent, ChatInput, ChatMessages } from "@/components/prototyping/chat-thread";
import { Turnstile, turnstileActive } from "@/components/turnstile";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, getCurrentUser } from "@/lib/supabase/guest";
import {
  buildHandoff,
  chatStorageKey,
  isProjectLimitError,
  newProjectInsert,
  type ChatMsg,
} from "@/lib/projects/create-from-chat";

export function NewProjectChat({ destination, turnstileEnabled = false }: { destination: string; turnstileEnabled?: boolean }) {
  const t = useTranslations("Projects");
  const router = useRouter();

  const [input, setInput] = useState("");
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [limit, setLimit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a visitor without a session needs the check (it guards signInAnonymously).
  const [needsCheck, setNeedsCheck] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  useEffect(() => {
    if (!turnstileActive(turnstileEnabled)) return;
    void getCurrentUser().then((u) => setNeedsCheck(!u));
  }, [turnstileEnabled]);

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
      let user: Awaited<ReturnType<typeof ensureSession>>;
      try {
        user = await ensureSession({ captchaToken: captcha });
      } finally {
        // Single-use token: a retry needs a fresh one.
        if (captcha) setCaptchaReset((k) => k + 1);
      }
      const { data, error: insertError } = await createClient()
        .from("projects")
        .insert(newProjectInsert({ userId: user.id, text, destination, now: new Date() }))
        .select("id")
        .single();
      if (insertError) throw insertError;
      projectId = data.id as string;
      track("project_created", { method: "chat" });
    } catch (err) {
      const message = err instanceof Error ? err.message : ((err as { message?: string })?.message ?? String(err));
      if (isProjectLimitError(message)) setLimit(true);
      else setError(message);
      setSent(null);
      setBusy(false);
      return;
    }

    // P5-13: the Design Studio's idea chat takes the first message from here
    // and asks the first question itself (/api/studio/spec), so no AI call is
    // made on this page any more.
    try {
      sessionStorage.setItem(
        chatStorageKey(projectId),
        JSON.stringify(buildHandoff({ text, reply: null, addition: null, done: false, error: null }))
      );
    } catch {
      // Storage blocked: the Studio opens with the brief in the input instead.
    }
    // refresh() so the server sees the session cookie the anonymous sign-in
    // just wrote, before the Studio renders.
    router.replace(`/projects/${projectId}/studio?start=chat`);
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
      {needsCheck && (
        <Turnstile enabled={turnstileEnabled} onToken={setCaptcha} resetKey={captchaReset} action="new_project" />
      )}
    </div>
  );
}
