"use client";

// The presentational pieces of the brief chat, shared by the "Help me describe
// it" modal (brief-chat.tsx) and the "Describe your idea" page
// (components/projects/new-project-chat.tsx): message bubbles with the
// thinking and error rows, the input row with its send button, and the AI
// consent checkbox. No fetching and no state of their own beyond the DOM.

import { Loader2, Send } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { ReadAloud } from "@/components/prototyping/read-aloud";
import type { ChatMsg } from "@/lib/projects/create-from-chat";
import { cn } from "@/lib/utils";

export type { ChatMsg };

/** The conversation: bubbles, then "Thinking…" and the failure line when they apply. */
export function ChatMessages({
  msgs,
  busy,
  error,
}: {
  msgs: ChatMsg[];
  busy: boolean;
  /** Shows the chat's failure line (Prototyping.chatFailed). */
  error: boolean;
}) {
  const t = useTranslations("Prototyping");
  return (
    <>
      {msgs.map((m, i) => (
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
      ))}
      {busy && (
        <p className="flex items-center gap-2 text-[12px] text-mutedtext" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("chatThinking")}
        </p>
      )}
      {error && <p className="text-[12px] font-medium text-destructive">{t("chatFailed")}</p>}
    </>
  );
}

/** One-line answer box with its send button; Enter sends. */
export function ChatInput({
  value,
  onChange,
  onSubmit,
  busy,
  canSend,
  placeholder,
  sendText,
  autoFocus,
  className,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Extra condition for sending besides non-empty text (e.g. consent ticked). */
  canSend?: boolean;
  placeholder?: string;
  /** A text button (e.g. "Start") instead of the send icon. */
  sendText?: string;
  autoFocus?: boolean;
  className?: string;
  /** After the send button (e.g. "Start over"). */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const ph = placeholder ?? t("chatPlaceholder");
  const enabled = !busy && !!value.trim() && canSend !== false;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && enabled && onSubmit()}
        placeholder={ph}
        aria-label={ph}
        disabled={busy}
        autoFocus={autoFocus}
        className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-white/60 bg-panel px-3 py-2 text-sm text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60 sm:min-h-0"
      />
      {sendText ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!enabled}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-cobalt px-4 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className={cn("h-4 w-4", locale === "ar" && "-scale-x-100")} />}
          {sendText}
        </button>
      ) : (
        <button
          type="button"
          onClick={onSubmit}
          disabled={!enabled}
          aria-label={t("chatSend")}
          className="grid h-9 w-9 place-items-center rounded-xl bg-cobalt text-white disabled:opacity-50 max-md:min-h-11 max-md:min-w-11"
        >
          <Send className={cn("h-4 w-4", locale === "ar" && "-scale-x-100")} />
        </button>
      )}
      {children}
    </div>
  );
}

/** "Send my brief to {destination}…" checkbox, optionally with the withdraw hint. */
export function ChatConsent({
  destination,
  checked,
  onChange,
  disabled,
  withHint,
  id = "chat-consent",
}: {
  destination: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  withHint?: boolean;
  id?: string;
}) {
  const t = useTranslations("Prototyping");
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-[12px] leading-relaxed text-heading">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          aria-describedby={withHint ? `${id}-hint` : undefined}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-cobalt"
        />
        <span id={`${id}-label`}>{t("aiConsentLabel", { destination })}</span>
      </label>
      {withHint && (
        <p id={`${id}-hint`} className="ps-[1.375rem] text-[11px] text-mutedtext">
          {t("aiConsentHint")}
        </p>
      )}
    </div>
  );
}
