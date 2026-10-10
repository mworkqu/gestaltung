"use client";

// Step 1 · Your idea. A short chat (POST /api/studio/spec): the visitor types,
// the AI asks at most a few tap-able questions, then returns the product
// spec, shown as a friendly summary card with ONE main button. The input is
// focused on load and after every reply (phones too) and is never disabled,
// so the keyboard stays up. Answers are kept in doc.answers and never asked
// again; "Edit" reopens the same conversation.
//
// Consent: a project created on /projects/new already has it; otherwise the
// existing consent line shows and is recorded on the first send.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Send } from "lucide-react";

import { ChatConsent } from "@/components/prototyping/chat-thread";
import type { ProductSpec, StudioDoc } from "@/lib/studio/schema";
import { answersFrom, factKeys, historyFrom, type IdeaMessage } from "@/lib/studio/client/steps";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../StudioShell";
import { linkCls, MainButton, Problem, StepFrame } from "../ui";
import { problemKey } from "./problem";

const accent = STEP_ACCENT.idea;

export function IdeaStep({
  ctx,
  doc,
  consented,
  destination,
  handoffIdea,
  brief,
  onConsented,
  onConfirm,
}: {
  ctx: StudioCtx;
  doc: StudioDoc | null;
  consented: boolean;
  destination: string;
  handoffIdea: string | null;
  brief: string | null;
  onConsented: () => void;
  onConfirm: (spec: ProductSpec, answers: Record<string, string>) => void;
}) {
  const t = useTranslations("Studio");
  const saved = useMemo(() => historyFrom(doc?.answers), [doc?.answers]);
  const [idea, setIdea] = useState(saved.idea);
  const [messages, setMessages] = useState<IdeaMessage[]>(saved.messages);
  const [spec, setSpec] = useState<ProductSpec | null>(doc?.spec ?? null);
  const [mode, setMode] = useState<"chat" | "summary">(doc ? "summary" : "chat");
  const [input, setInput] = useState(!doc && !handoffIdea && brief ? brief.slice(0, 600) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ticked, setTicked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const focusInput = () => {
    // After paint, so it also works right after a reply re-renders the list.
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  async function ask(nextIdea: string, history: IdeaMessage[]) {
    setBusy(true);
    setProblem(null);
    const r = await ctx.api.spec({ idea: nextIdea, messages: history, locale: ctx.locale });
    setBusy(false);
    if (!r.ok) {
      setProblem(t(problemKey(r)));
      focusInput();
      return;
    }
    if ("spec" in r.data) {
      setSpec(r.data.spec);
      setMode("summary");
      return;
    }
    setMessages([...history, { role: "assistant", text: r.data.question, choices: r.data.choices }]);
    focusInput();
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    if (!consented) {
      if (!ticked) {
        setProblem(t("consentNeeded"));
        return;
      }
      const ok = await ctx.api.giveConsent(destination);
      if (!ok) {
        setProblem(t("failed"));
        return;
      }
      onConsented();
    }
    setInput("");
    if (!idea) {
      setIdea(text);
      await ask(text, messages);
    } else {
      const history: IdeaMessage[] = [...messages, { role: "user", text }];
      setMessages(history);
      await ask(idea, history);
    }
  }

  // Opened from /projects/new: carry on with the first message, once.
  useEffect(() => {
    if (started.current || !handoffIdea || doc) return;
    started.current = true;
    setIdea(handoffIdea);
    void ask(handoffIdea, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [handoffIdea]);

  useEffect(() => {
    if (mode === "chat") focusInput();
  }, [mode]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, idea]);

  const last = messages[messages.length - 1];
  const choices = !busy && last?.role === "assistant" ? last.choices ?? [] : [];
  const shown: IdeaMessage[] = [{ role: "assistant", text: t("ideaFirst") }, ...(idea ? [{ role: "user" as const, text: idea }] : []), ...messages];

  const title = t("title_idea");
  const n = ctx.n("idea");

  if (mode === "summary" && spec) {
    const facts = factKeys(spec);
    return (
      <StepFrame
        step="idea"
        n={n}
        title={title}
        headline={t("summaryHeading")}
        intro={t("intro_summary")}
        footer={
          <MainButton onClick={() => onConfirm(spec, answersFrom(idea || spec.oneLine || spec.name, messages))}>
            {t("looksRight")}
          </MainButton>
        }
        secondary={
          <button type="button" className={linkCls} onClick={() => setMode("chat")}>
            {t("edit")}
          </button>
        }
      >
        <div
          className="tile space-y-4 border-0 p-5 sm:p-6"
          style={{ background: `linear-gradient(135deg, ${accent.soft} 0%, #eef2f7 70%)` }}
          data-testid="studio-idea-summary"
        >
          <div className="space-y-1">
            <h2 className="text-xl font-extrabold tracking-tight text-heading" dir="auto">
              {spec.name}
            </h2>
            {spec.oneLine && (
              <p className="text-sm leading-relaxed text-body" dir="auto">
                {spec.oneLine}
              </p>
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {facts.map((k) => (
              <li key={k} className="flex items-start gap-2 text-sm font-medium text-heading">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: accent.base }}>
                  <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden />
                </span>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame step="idea" n={n} title={title} headline={t("headline_idea")} intro={t("intro_idea")}>
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t("chatLog")}
        className="max-h-[52dvh] space-y-3 overflow-y-auto rounded-2xl bg-panel/60 p-3 shadow-neu-inset sm:p-4"
      >
        {shown.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <p
              dir="auto"
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed motion-safe:animate-rise",
                m.role === "user" ? "rounded-ee-md bg-cobalt text-white" : "rounded-es-md bg-surface text-heading shadow-neu-sm",
              )}
            >
              {m.text}
            </p>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start" data-testid="studio-typing">
            <span className="inline-flex items-center gap-1 rounded-2xl rounded-es-md bg-surface px-3.5 py-3 shadow-neu-sm">
              <span className="sr-only">{t("thinking")}</span>
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full motion-safe:animate-bounce"
                  style={{ background: accent.base, animationDelay: `${d * 140}ms` }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {choices.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="studio-choices">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => void send(c)}
              dir="auto"
              className="min-h-11 rounded-full border-2 bg-surface px-4 py-2 text-sm font-semibold text-heading shadow-neu-sm transition-[transform,background-color] hover:bg-white active:scale-[0.97]"
              style={{ borderColor: accent.base }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={idea ? t("yourAnswer") : t("ideaPlaceholder")}
          aria-label={idea ? t("yourAnswer") : t("ideaPlaceholder")}
          dir="auto"
          autoFocus
          enterKeyHint="send"
          maxLength={1500}
          className="min-h-12 min-w-0 flex-1 rounded-full border border-white/60 bg-panel px-4 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={t("send")}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-cobalt text-white transition-colors hover:bg-cobalt-hover disabled:opacity-50"
        >
          <Send className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.75} />
        </button>
      </form>
      {!consented && (
        <ChatConsent destination={destination} checked={ticked} onChange={setTicked} disabled={busy} id="studio-consent" />
      )}
      {problem && <Problem>{problem}</Problem>}
      {spec && (
        <button type="button" className={linkCls} onClick={() => setMode("summary")}>
          {t("looksRight")}
        </button>
      )}
    </StepFrame>
  );
}
