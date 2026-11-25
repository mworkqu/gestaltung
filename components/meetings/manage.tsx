"use client";

// The client's own page for one meeting: when, how, where, the rules, and —
// while the free-change window is open — Move and Cancel. After the window it
// shows the WhatsApp line instead, because changing it then is a conversation.

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { cancelMeetingAction, moveMeetingAction } from "@/app/[locale]/meetings/[token]/actions";

export type MeetingView = {
  token: string;
  label: string;
  statusKey: string;
  mode: "online" | "studio";
  modeLabel: string;
  modeDetail: string;
  topic: string | null;
  meetLink: string | null;
  lines: string[];
  company: string;
  /** Free to move or cancel right now. */
  canChange: boolean;
  /** Slot options to move to: value + label in the reader's language. */
  slots: { value: string; label: string }[];
  whatsappUrl: string;
};

const card = "neu mx-auto w-full max-w-lg space-y-4 p-5 sm:p-8";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-cobalt px-6 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover active:scale-[0.98] disabled:opacity-60";
const ghost =
  "inline-flex min-h-11 items-center px-2 text-sm font-semibold text-cobalt underline-offset-2 hover:underline disabled:opacity-60";
const field =
  "w-full min-h-11 rounded-xl border border-white/60 bg-panel px-3 py-2 text-base text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-xs font-semibold text-mutedtext">{label}</span>
      <span className="text-sm text-heading">{children}</span>
    </div>
  );
}

export function MeetingManage({ view }: { view: MeetingView }) {
  const t = useTranslations("Meetings");
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "moving" | "confirmCancel" | "cancelled" | "moved">("idle");
  const [slot, setSlot] = useState(view.slots[0]?.value ?? "");
  const [label, setLabel] = useState(view.label);
  const [error, setError] = useState<string | null>(null);

  const ERRORS: Record<string, string> = {
    too_late: "tooLate",
    slot_taken: "errorSlotTaken",
    too_soon: "errorTooSoon",
    bad_slot: "errorBadSlot",
    not_set_up: "notReady",
    bad_token: "notFound",
  };
  const say = (code: string) => t(ERRORS[code] ?? "error");

  function doCancel() {
    setError(null);
    start(async () => {
      const r = await cancelMeetingAction(view.token);
      if (r.ok) setState("cancelled");
      else {
        setError(say(r.error));
        setState("idle");
      }
    });
  }

  function doMove() {
    setError(null);
    start(async () => {
      const r = await moveMeetingAction(view.token, slot);
      if (r.ok) {
        setLabel(view.slots.find((s) => s.value === slot)?.label ?? label);
        setState("moved");
      } else setError(say(r.error));
    });
  }

  const finished = state === "cancelled";

  return (
    <div className={card} data-testid="meeting-card" data-state={finished ? "cancelled" : state}>
      <h1 className="text-xl font-black tracking-tight text-heading">{t("title")}</h1>

      {finished ? (
        <p className="text-sm text-body" role="status" data-testid="meeting-cancelled">
          {t("cancelled")}
        </p>
      ) : (
        <>
          {state === "moved" && (
            <p className="text-sm font-medium text-cobalt" role="status" data-testid="meeting-moved">
              {t("moved")}
            </p>
          )}

          <div className="space-y-2">
            <Row label={t("whenLabel")}>{label}</Row>
            <Row label={t("howLabel")}>{view.modeLabel}</Row>
            <Row label={t("statusBooked")}>{t(view.statusKey)}</Row>
            {view.meetLink && (
              <Row label={t("meetLinkLabel")}>
                <a href={view.meetLink} className="text-cobalt underline-offset-2 hover:underline" dir="ltr">
                  {view.meetLink}
                </a>
              </Row>
            )}
            {view.topic && <Row label={t("topicLabel")}>{view.topic}</Row>}
          </div>

          <p className="text-sm text-body">{view.modeDetail}</p>

          <ul className="space-y-1 text-sm text-mutedtext" data-testid="meeting-rules">
            {view.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {error && (
            <p className="text-sm font-medium text-destructive" role="alert" data-testid="meeting-error">
              {error}
            </p>
          )}

          {view.canChange ? (
            <>
              {state === "moving" ? (
                <div className="space-y-3" data-testid="meeting-move">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-mutedtext">{t("moveTitle")}</span>
                    <select value={slot} onChange={(e) => setSlot(e.target.value)} className={field} data-testid="meeting-move-slot">
                      {view.slots.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={doMove} disabled={pending || !slot} className={button}>
                      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {t("moveConfirm")}
                    </button>
                    <button type="button" onClick={() => setState("idle")} disabled={pending} className={ghost}>
                      {t("keep")}
                    </button>
                  </div>
                </div>
              ) : state === "confirmCancel" ? (
                <div className="space-y-3" data-testid="meeting-cancel-confirm">
                  <p className="text-sm font-semibold text-heading">{t("cancelTitle")}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={doCancel} disabled={pending} className={button}>
                      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                      {t("cancelConfirm")}
                    </button>
                    <button type="button" onClick={() => setState("idle")} disabled={pending} className={ghost}>
                      {t("keep")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setState("moving")}
                    disabled={pending || !view.slots.length}
                    className={button}
                    data-testid="meeting-move-open"
                  >
                    {t("move")}
                  </button>
                  <button type="button" onClick={() => setState("confirmCancel")} disabled={pending} className={ghost} data-testid="meeting-cancel-open">
                    {t("cancel")}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2" data-testid="meeting-too-late">
              <p className="text-sm text-body">{t("tooLate")}</p>
              <a href={view.whatsappUrl} className={ghost}>
                {t("whatsapp")}
              </a>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-faint">{view.company}</p>
    </div>
  );
}
