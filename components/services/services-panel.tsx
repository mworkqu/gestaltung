"use client";

// Engineer services on the Engineering page (0092): each card shows the
// server's quote (components, wires, hours) BEFORE payment, then opens a
// Fawran payment (POST /api/billing/service). Approval opens the job, which
// then shows in the project's jobs list. Copy: "Services" + "Tokens" namespaces.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cpu, PencilRuler, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FawranCheckout, type OpenPayment } from "@/components/payments/fawran-checkout";
import type { Quote, ServiceKind } from "@/lib/services/quote";
import { round2 } from "@/lib/format/money";

export type ServiceCard = { kind: ServiceKind; quote: Quote | null; ready: boolean; open: boolean };

const ICON = { assembly: Wrench, cad_engineer: PencilRuler, pcb_gerber: Cpu } as const;

export function ServicesPanel({ projectId, cards, signedIn }: { projectId: string; cards: ServiceCard[]; signedIn: boolean }) {
  const t = useTranslations("Services");
  const [open, setOpen] = useState<{ payment: OpenPayment; kind: ServiceKind } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<ServiceKind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function buy(kind: ServiceKind) {
    setBusy(kind);
    setProblem(null);
    try {
      const res = await fetch("/api/billing/service", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, service: kind, note: notes[kind] ?? "" }),
      });
      const body = (await res.json().catch(() => ({}))) as { payment?: OpenPayment; error?: string };
      if (!res.ok || !body.payment) setProblem(t(`error_${["not_ready", "already_open", "not_configured", "sign_in"].includes(body.error ?? "") ? body.error : "failed"}`));
      else setOpen({ payment: body.payment, kind });
    } catch {
      setProblem(t("error_failed"));
    }
    setBusy(null);
  }

  const money = (n: number) => t("qar", { n: String(round2(n)) });

  return (
    <section className="neu space-y-5 p-6" data-testid="engineer-services">
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-azure rtl:font-sans rtl:tracking-normal">{t("kicker")}</p>
        <h2 className="text-lg font-extrabold text-heading">{t("title")}</h2>
        <p className="max-w-[65ch] text-sm text-mutedtext">{t("intro")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map(({ kind, quote, ready, open: jobOpen }) => {
          const Icon = ICON[kind];
          return (
            <div key={kind} className="tile flex flex-col gap-3 p-4" data-testid={`service-${kind}`}>
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-cobalt" strokeWidth={1.75} aria-hidden />
                <h3 className="text-sm font-bold text-heading">{t(`${kind}_title`)}</h3>
              </div>
              <p className="text-xs leading-relaxed text-body">{t(`${kind}_text`)}</p>
              {quote && ready ? (
                <>
                  {/* no-scroll: two narrow columns inside a card */}
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-borderstrong/40">
                      {quote.lines.map((l) => (
                        <tr key={l.key}>
                          <td className="py-1 text-mutedtext">
                            {t(`line_${l.key}`, { qty: String(l.qty), unit: money(l.unit_qar) })}
                          </td>
                          <td className="py-1 text-end font-mono tabular-nums">{money(l.qar)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-1.5 font-bold text-heading">{t("total")}</td>
                        <td className="py-1.5 text-end font-mono font-bold tabular-nums text-heading">{money(quote.total_qar)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[11px] text-mutedtext">{t("days", { n: String(quote.days) })}</p>
                  {jobOpen ? (
                    <p className="text-xs font-semibold text-heading">{t("inProgress")}</p>
                  ) : signedIn ? (
                    <>
                      <textarea
                        value={notes[kind] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [kind]: e.target.value }))}
                        maxLength={1000}
                        rows={2}
                        placeholder={t("notePlaceholder")}
                        className="w-full rounded-xl bg-panel px-3 py-2 text-xs text-heading shadow-neu-inset outline-none focus:ring-2 focus:ring-cobalt/60"
                      />
                      <Button size="sm" onClick={() => void buy(kind)} disabled={busy !== null} className="mt-auto">
                        {t("pay", { total: money(quote.total_qar) })}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-mutedtext">{t("error_sign_in")}</p>
                  )}
                </>
              ) : (
                <p className="text-xs text-mutedtext">{t(kind === "cad_engineer" ? "needParts" : "needWiring")}</p>
              )}
            </div>
          );
        })}
      </div>
      {open && (
        <FawranCheckout payment={open.payment} productLabel={t(`${open.kind}_title`)} onClose={() => setOpen(null)}>
          <p className="text-xs text-mutedtext">{t("afterPay")}</p>
        </FawranCheckout>
      )}
      {problem && <p className="text-sm font-medium text-destructive">{problem}</p>}
    </section>
  );
}
