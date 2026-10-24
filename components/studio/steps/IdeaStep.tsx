"use client";

// Step 1 · Your idea (W3). A real conversation beside a LIVE product card:
//
//  * Split layout: the chat at the start, the card at the end (logical grid
//    columns, so Arabic mirrors by itself); on phones the card is a collapsible
//    panel above the chat.
//  * The card fills in straight from the visitor's own words (draftSpec: no AI,
//    instant) and highlights each row the moment it is learned; the AI's spec
//    then completes it. While the AI thinks: a typing dot in the chat and
//    skeleton bars in the rows still to come (shown at once, well under 300 ms).
//  * The chat never disappears. After the card is shown, anything typed goes to
//    POST /api/studio/spec with `current` and gets a real reply (Part A): a change
//    ("make it solar") updates the card and shows an "updated" chip listing what
//    changed; a question ("what is UR10") is answered and the card stays as it
//    is (no chip — the chip shows only when the spec really changed). When parts were already picked for the old
//    card, the ONE main button becomes "Update my parts" — later steps are never
//    redone silently.
//  * The input is focused on load and after every reply (phones too) and is
//    never disabled, so the keyboard stays up. Answers live in doc.answers and
//    are never asked again.
//  * 2026-10-18: "Our understanding" (UnderstandingPanel) sits on top of the main
//    column — goal, how it works, the parts with counts and the build tier — and
//    the chat moves to the side column. Every turn the agent rebuilds the whole
//    understanding. Ideation tokens: the balance line above the chat (a new idea
//    1, edits 1 per N messages, × the tier); a tier change shows a notice.
//
// Consent: a project created on /projects/new already has it; otherwise the
// existing consent line shows and is recorded on the first send.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Coins, Minus, Plus, Send, TrendingUp } from "lucide-react";

import { ChatConsent } from "@/components/prototyping/chat-thread";
import { LIMITS, type ActuatorKind, type ProductSpec, type StudioDoc } from "@/lib/studio/schema";
import { actuatorTotals, setActuatorCount } from "@/lib/studio/actuators";
import { arabicCountForm } from "@/lib/text/count";
import { draftSpec } from "@/lib/studio/ai/spec-guards";
import {
  answersFrom, cardRows, changedRows, forModel, historyFrom, sameSpec, type CardRow, type IdeaMessage,
} from "@/lib/studio/client/steps";
import { STEP_ACCENT } from "@/lib/studio/palette";
import { IDEATION } from "@/lib/studio/tiers";
import type { TokenInfo } from "@/lib/studio/client/api";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { StudioCtx } from "../studio-ctx";
import { AiWait } from "../AiWait";
import { UnderstandingPanel } from "./UnderstandingPanel";
import { Bar, MainButton, Problem, StepFrame } from "../ui";
import { problemKey } from "./problem";
import { intlTag, asLocale } from "@/lib/locale";

const accent = STEP_ACCENT.idea;
const FRESH_MS = 1600;

export function IdeaStep({
  ctx,
  doc,
  consented,
  destination,
  handoffIdea,
  brief,
  onConsented,
  onConfirm,
  onDraft,
}: {
  ctx: StudioCtx;
  doc: StudioDoc | null;
  consented: boolean;
  destination: string;
  handoffIdea: string | null;
  brief: string | null;
  onConsented: () => void;
  onConfirm: (spec: ProductSpec, answers: Record<string, string>) => void;
  /** Saves a card the chat changed right away (the parts then follow it). */
  onDraft?: (spec: ProductSpec, answers: Record<string, string>) => void;
}) {
  const t = useTranslations("Studio");
  const saved = useMemo(() => historyFrom(doc?.answers), [doc?.answers]);
  const [idea, setIdea] = useState(saved.idea);
  const [messages, setMessages] = useState<IdeaMessage[]>(saved.messages);
  const [spec, setSpec] = useState<ProductSpec | null>(doc?.spec ?? null);
  const [input, setInput] = useState(!doc && !handoffIdea && brief ? brief.slice(0, 600) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ticked, setTicked] = useState(false);
  // Phones: the card panel opens by itself once the spec is there.
  const [cardOpen, setCardOpen] = useState(Boolean(doc?.spec));
  const [understandingOpen, setUnderstandingOpen] = useState(true);
  const [tokens, setTokens] = useState<TokenInfo | null>(null);
  const [outOfTokens, setOutOfTokens] = useState(false);
  /** Shown once after the turn that moved the build to another tier (never stored, never sent to the AI). */
  const [tierNotice, setTierNotice] = useState<{ dir: "up" | "down"; tier: TokenInfo["tier"]; m: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const focusInput = () => {
    // After paint, so it also works right after a reply re-renders the list.
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  async function ask(nextIdea: string, history: IdeaMessage[], current: ProductSpec | null) {
    setBusy(true);
    setProblem(null);
    setOutOfTokens(false);
    setTierNotice(null);
    const r = await ctx.api.spec({ idea: nextIdea, messages: forModel(history), locale: ctx.locale, current });
    setBusy(false);
    if (!r.ok) {
      if (r.error === "no_tokens") {
        setOutOfTokens(true);
        void ctx.api.tokens?.().then((v) => v && setTokens(v));
      } else setProblem(t(problemKey(r)));
      focusInput();
      return;
    }
    const data = r.data;
    if (data.tokens) {
      setTokens(data.tokens);
      if (data.tokens.tierChange) setTierNotice({ dir: data.tokens.tierChange, tier: data.tokens.tier, m: data.tokens.multiplier });
    }
    if ("question" in data) {
      setMessages([...history, { role: "assistant", text: data.question, choices: data.choices }]);
      focusInput();
      return;
    }
    const next = data.spec ?? null;
    // The chip only when the card really changed (deep compare), never for an answer.
    const updated = Boolean(next && current && !sameSpec(next, current));
    if (next && (!current || updated)) setSpec(next);
    if (!current) setCardOpen(true);
    const reply = data.reply?.trim() ?? "";
    if (reply || updated) {
      const changedLabels = "changed" in data ? data.changed : [];
      setMessages([...history, { role: "assistant", text: reply, note: true, ...(updated ? { changed: changedLabels } : {}) }]);
    }
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
      await ask(text, messages, null);
    } else {
      const history: IdeaMessage[] = [...messages, { role: "user", text }];
      setMessages(history);
      // Once the card is there, every message is a change request on top of it.
      await ask(idea, history, spec);
    }
  }

  // Every card change (a chat turn, the count stepper) is saved at once.
  const [partsCleared, setPartsCleared] = useState(false);
  useEffect(() => {
    if (!spec || !onDraft || busy) return;
    if (doc && sameSpec(spec, doc.spec)) return;
    if ((doc?.components.length ?? 0) > 0) setPartsCleared(true);
    onDraft(spec, answersFrom(idea || spec.oneLine || spec.name, messages));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the card itself
  }, [spec, busy]);

  // The token line: balance + tier (grants the welcome tokens on first sight).
  useEffect(() => {
    let live = true;
    void ctx.api.tokens?.().then((v) => live && v && setTokens(v));
    return () => {
      live = false;
    };
  }, [ctx.api]);

  // Opened from /projects/new: carry on with the first message, once.
  useEffect(() => {
    if (started.current || !handoffIdea || doc) return;
    started.current = true;
    setIdea(handoffIdea);
    // The brief that pre-filled the box is the message being sent: leave the input empty.
    setInput("");
    void ask(handoffIdea, [], null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [handoffIdea]);

  // No 3D engine and no geometry worker are fetched here (owner 2026-10-11): the Parts
  // step shows a picture drawn by the worker, which starts when that step opens.

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, idea]);

  // ── The live card ────────────────────────────────────────────────────────
  const draft = useMemo(() => (spec ? null : draftSpec(idea, forModel(messages), ctx.locale)), [spec, idea, messages, ctx.locale]);
  const cardSpec = spec ?? draft!.spec;
  const rows = useMemo(() => cardRows(cardSpec, spec ? "all" : draft!.touched), [cardSpec, spec, draft]);
  const fresh = useFreshRows(rows);
  const known = rows.filter((r) => r.key).length;

  const last = messages[messages.length - 1];
  const choices = !busy && last?.role === "assistant" && !last.note ? last.choices ?? [] : [];
  // Older docs kept an empty note after each change request: nothing to show for those.
  const shown: IdeaMessage[] = [
    { role: "assistant", text: t("ideaFirst") },
    ...(idea ? [{ role: "user" as const, text: idea }] : []),
    ...messages.filter((m) => !m.note || m.text.trim() || m.changed),
  ];

  // One main button: "Update my parts" only when parts were picked for a card that has since changed.
  const changed = Boolean(spec && doc && !sameSpec(spec, doc.spec));
  // A chat change that cleared parts picked earlier: the button says "Update my parts".
  const redoParts = (changed && (doc?.components.length ?? 0) > 0) || partsCleared;
  const confirm = () => spec && onConfirm(spec, answersFrom(idea || spec.oneLine || spec.name, messages));

  const label = spec ? t("ideaCard.refinePlaceholder") : idea ? t("yourAnswer") : t("ideaPlaceholder");

  return (
    <StepFrame
      step="idea"
      n={ctx.n("idea")}
      title={t("title_idea")}
      headline={spec ? t("summaryHeading") : t("headline_idea")}
      intro={spec ? t("intro_summary") : t("intro_idea")}
      footer={
        spec ? (
          <MainButton onClick={confirm} disabled={busy} data-testid="studio-idea-confirm">
            {redoParts ? t("ideaCard.updateParts") : t("looksRight")}
          </MainButton>
        ) : undefined
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start lg:gap-6">
        {/* "Our understanding": top of the main column (first on phones too). */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <UnderstandingPanel
            spec={spec}
            busy={busy}
            open={understandingOpen}
            onToggle={() => setUnderstandingOpen((o) => !o)}
            // The agent's class is a guess; the user always gets the last word.
            // This rides the same save path as every other card edit, so later
            // steps are cleared the same way — the parts really do differ by class.
            onBuildClass={spec && !busy ? (buildClass) => setSpec({ ...spec, buildClass }) : undefined}
          />
        </div>

        {/* The chat: the side column on desktop (sticky), under the understanding on phones. */}
        <div className="min-w-0 space-y-3 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1" data-testid="studio-idea-chat">
          <TokenLine tokens={tokens} />
          <div
            ref={logRef}
            role="log"
            aria-live="polite"
            aria-label={t("chatLog")}
            className="max-h-[52dvh] space-y-3 overflow-y-auto rounded-2xl bg-panel/60 p-3 shadow-neu-inset sm:p-4 lg:max-h-[60dvh]"
          >
            {shown.map((m, i) => (
              <div
                key={i}
                className={cn("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}
                data-testid={m.note ? "studio-idea-reply" : undefined}
              >
                {m.text.trim() && (
                  <p
                    dir="auto"
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed motion-safe:animate-rise",
                      m.role === "user" ? "rounded-ee-md bg-cobalt text-white" : "rounded-es-md bg-surface text-heading shadow-neu-sm",
                    )}
                  >
                    {m.text}
                  </p>
                )}
                {m.changed && <UpdatedChip changed={m.changed} />}
              </div>
            ))}
            {tierNotice && (
              <p
                className="flex items-start gap-2 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-heading shadow-neu-sm motion-safe:animate-rise"
                role="status"
                data-testid="studio-tier-notice"
              >
                <TrendingUp className={cn("mt-px h-4 w-4 shrink-0", tierNotice.dir === "down" && "-scale-y-100")} style={{ color: accent.ink }} aria-hidden />
                {t(tierNotice.dir === "up" ? "tokens.tierUp" : "tokens.tierDown", {
                  tier: t(`tiers.${tierNotice.tier}`),
                  m: String(tierNotice.m),
                })}
              </p>
            )}
            {busy && (
              <div className="flex justify-start" data-testid="studio-typing">
                <span className="inline-flex items-center gap-2 rounded-2xl rounded-es-md bg-surface px-3.5 py-3 shadow-neu-sm">
                  <span className="sr-only">{t("thinking")}</span>
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full motion-safe:animate-bounce"
                      style={{ background: accent.base, animationDelay: `${d * 140}ms` }}
                    />
                  ))}
                  <AiWait kind="idea" active={busy} className="ms-1 text-sm" />
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
              placeholder={label}
              aria-label={label}
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
          {outOfTokens && (
            <Problem>
              {t("tokens.empty")}{" "}
              <Link href="/tokens" className="font-semibold underline underline-offset-2">
                {t("tokens.contact")}
              </Link>
            </Problem>
          )}
          {problem && <Problem>{problem}</Problem>}
        </div>

        {/* The product card: under the understanding on desktop, after the chat on phones. */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2" data-testid="studio-idea-card-col">
          <SpecCard
            spec={cardSpec}
            draft={!spec}
            idea={idea}
            rows={rows}
            fresh={fresh}
            busy={busy}
            known={known}
            open={cardOpen}
            onToggle={() => setCardOpen((o) => !o)}
            // Part B: the count stepper is a card change like any other (→ "Update my parts").
            onCount={spec && !busy ? (kind, n) => setSpec(setActuatorCount(spec, kind, n)) : undefined}
          />
          {redoParts && (
            <p className="mt-3 text-sm leading-relaxed text-mutedtext" data-testid="studio-update-parts-note">
              {t("ideaCard.updatePartsNote")}
            </p>
          )}
        </div>
      </div>
    </StepFrame>
  );
}

/** "Ideation tokens: 4" + the rule (new idea 1, edits 1 per N messages, × tier). Hidden before 0088 runs. */
function TokenLine({ tokens }: { tokens: TokenInfo | null }) {
  const t = useTranslations("Studio");
  const locale = useLocale();
  if (!tokens) return null;
  const low = !tokens.admin && (tokens.balance ?? 0) <= 1;
  return (
    <div className="space-y-1 rounded-2xl bg-panel px-3.5 py-2.5 shadow-neu-sm" data-testid="studio-tokens" data-balance={tokens.balance ?? ""}>
      <p className="flex items-center gap-2 text-sm font-bold text-heading">
        <Coins className="h-4 w-4 shrink-0" style={{ color: accent.ink }} strokeWidth={2} aria-hidden />
        <span className={cn(low && "text-destructive")}>
          {tokens.admin ? t("tokens.admin") : t("tokens.balance", { n: String(tokens.balance ?? 0) })}
        </span>
        {!tokens.admin && (
          <Link href="/tokens" className="ms-auto text-xs font-semibold text-cobalt underline-offset-2 hover:underline" data-testid="studio-get-tokens">
            {t("tokens.get")}
          </Link>
        )}
      </p>
      {tokens.passUntil && (
        <p className="text-[11px] font-semibold text-heading" data-testid="studio-pass">
          {t("tokens.pass", {
            date: new Intl.DateTimeFormat(intlTag(asLocale(locale)), { day: "numeric", month: "short" }).format(
              new Date(tokens.passUntil),
            ),
          })}
        </p>
      )}
      <p className="text-[11px] leading-snug text-mutedtext">
        {t("tokens.rule", {
          idea: String(IDEATION.newIdeaCost * tokens.multiplier),
          cost: String(tokens.multiplier),
          every: String(tokens.turnsPerToken),
          next: String(tokens.nextChargeIn),
        })}
      </p>
    </div>
  );
}

/** "Card updated: Now solar powered · 6 joints" — only after a turn that really changed the card. */
function UpdatedChip({ changed }: { changed: string[] }) {
  const t = useTranslations("Studio");
  return (
    <p
      className="inline-flex max-w-[85%] items-start gap-1.5 rounded-full bg-white/70 px-3 py-1.5 text-xs font-semibold text-heading shadow-neu-sm motion-safe:animate-rise"
      data-testid="studio-idea-updated"
    >
      <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full" style={{ background: accent.base }}>
        <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} aria-hidden />
      </span>
      <span dir="auto">
        {t("ideaCard.updatedChip")}
        {changed.length > 0 && <span className="font-medium text-body">{`: ${changed.join(" · ")}`}</span>}
      </span>
    </p>
  );
}

/** Row ids that just changed, for a short highlight (cleared after FRESH_MS). */
function useFreshRows(rows: CardRow[]): Set<string> {
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const prev = useRef(rows);
  const key = rows.map((r) => `${r.id}:${r.key ?? ""}`).join("|");
  useEffect(() => {
    const changed = changedRows(prev.current, rows);
    prev.current = rows;
    if (!changed.length) return;
    setFresh(new Set(changed));
    const id = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => {
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the row contents
  }, [key]);
  return fresh;
}

/** The product card the owner loves (same gradient tile, check bullets), now live. */
function SpecCard({
  spec,
  draft,
  idea,
  rows,
  fresh,
  busy,
  known,
  open,
  onToggle,
  onCount,
}: {
  spec: ProductSpec;
  draft: boolean;
  idea: string;
  rows: CardRow[];
  fresh: Set<string>;
  busy: boolean;
  known: number;
  open: boolean;
  onToggle: () => void;
  onCount?: (kind: ActuatorKind, count: number) => void;
}) {
  const t = useTranslations("Studio");
  const name = draft ? t("ideaCard.draftName") : spec.name;
  const line = draft ? idea.slice(0, 160) : spec.oneLine;
  const bodyId = "studio-idea-card-body";
  return (
    <section
      aria-label={t("ideaCard.aria")}
      className="tile overflow-hidden border-0 p-0"
      style={{ background: `linear-gradient(135deg, ${accent.soft} 0%, #eef2f7 70%)` }}
      data-testid="studio-idea-summary"
      data-state={draft ? "draft" : "spec"}
    >
      {/* Phones: one bar that opens and closes the card. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={open ? t("ideaCard.hide") : t("ideaCard.show")}
        className="flex min-h-12 w-full items-center gap-3 px-5 py-3 text-start lg:hidden"
        data-testid="studio-idea-card-toggle"
      >
        <span className="min-w-0 flex-1">
          {/* Open: the card's own heading below says the name, so the bar keeps only the count. */}
          <span className={cn("block truncate text-sm font-bold text-heading", open && "sr-only")} dir="auto">
            {name}
          </span>
          <span className="block text-xs text-mutedtext">{t("ideaCard.known", { n: String(known), total: String(rows.length) })}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn("h-5 w-5 shrink-0 text-mutedtext transition-transform motion-reduce:transition-none", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>

      <div id={bodyId} className={cn("space-y-4 p-5 max-lg:pt-1 sm:p-6", !open && "max-lg:hidden")}>
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold tracking-tight text-heading" dir="auto">
            {name}
          </h2>
          {!draft && spec.scaleNote && (
            <p className="text-xs font-semibold leading-relaxed" style={{ color: accent.ink }} dir="auto" data-testid="studio-idea-scale">
              {spec.scaleNote}
            </p>
          )}
          {line && (
            <p className="text-sm leading-relaxed text-body" dir="auto">
              {line}
            </p>
          )}
          {draft && busy && (
            <p className="text-xs font-semibold motion-safe:animate-pulse" style={{ color: accent.ink }}>
              {t("ideaCard.learning")}
            </p>
          )}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" data-testid="studio-idea-facts">
          {rows.map((r) => (
            <li
              key={r.id}
              data-row={r.id}
              data-known={r.key ? "1" : "0"}
              data-fresh={fresh.has(r.id) ? "1" : undefined}
              className={cn(
                "flex items-start gap-2 rounded-xl px-1.5 py-1 text-sm font-medium transition-[background-color,box-shadow] duration-500 motion-reduce:transition-none",
                fresh.has(r.id) && "bg-white/70 ring-2",
              )}
              style={fresh.has(r.id) ? ({ "--tw-ring-color": accent.base } as React.CSSProperties) : undefined}
            >
              {r.key ? (
                <>
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: accent.base }}>
                    <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden />
                  </span>
                  <span className="text-heading">{t(r.key)}</span>
                </>
              ) : (
                <>
                  <span aria-hidden className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-dashed" style={{ borderColor: accent.base }} />
                  {busy ? (
                    <Bar className="mt-1 h-3 w-32" />
                  ) : (
                    <span className="text-faint">{r.hint ? t(`ideaCard.${r.hint}`) : null}</span>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        {!draft && <ActuatorLines spec={spec} onCount={onCount} />}
        {!draft && spec.features.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-mutedtext">{t("ideaCard.includes")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {spec.features.slice(0, 5).map((f) => (
                <li key={f} dir="auto" className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-heading">
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Part B: "6 joints · servo motors" with a 1–8 stepper per kind of mover. */
function ActuatorLines({ spec, onCount }: { spec: ProductSpec; onCount?: (kind: ActuatorKind, count: number) => void }) {
  const t = useTranslations("Studio");
  const totals = actuatorTotals(spec);
  if (!totals.length) return null;
  const { countMin, countMax } = LIMITS.actuators;
  return (
    <ul className="space-y-2" data-testid="studio-idea-actuators">
      {totals.map(({ kind, count }) => {
        const line = t(`ideaCard.act_${kind}`, { count: String(count), form: arabicCountForm(count) });
        const step = (n: number) => onCount?.(kind, n);
        return (
          <li key={kind} data-kind={kind} data-count={count} className="flex items-center gap-2 rounded-xl bg-white/70 px-2 py-1.5">
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: accent.base }}>
              <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-sm font-semibold text-heading" dir="auto" data-testid="studio-idea-actuator-line">
              {line}
            </span>
            {onCount && (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => step(count - 1)}
                  disabled={count <= countMin}
                  aria-label={`${t("ideaCard.actFewer")}: ${line}`}
                  className="grid h-11 w-11 place-items-center rounded-full bg-surface text-heading shadow-neu-sm transition-transform active:scale-95 disabled:opacity-40"
                  data-testid="studio-idea-actuator-fewer"
                >
                  <Minus className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => step(count + 1)}
                  disabled={count >= countMax}
                  aria-label={`${t("ideaCard.actMore")}: ${line}`}
                  className="grid h-11 w-11 place-items-center rounded-full bg-surface text-heading shadow-neu-sm transition-transform active:scale-95 disabled:opacity-40"
                  data-testid="studio-idea-actuator-more"
                >
                  <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
