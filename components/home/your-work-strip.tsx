"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, ChevronRight, Loader2, RotateCcw } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useCart } from "@/components/parts/cart-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { projectHref } from "@/lib/projects/href";
import { normaliseOrderStatus, orderShort, type OrderStatus } from "@/lib/orders/status";
import { arabicCountForm } from "@/lib/text/count";
import { buildReorderPlan } from "@/lib/home/your-work";
import { loadReorderInputs, loadYourWork, type YourWorkData } from "@/lib/home/your-work-data";
import { cn } from "@/lib/utils";
import { intlTag, asLocale } from "@/lib/locale";

// Signed-in "Your work" strip at the top of the v2 home (P3-05 / WF-33).
//
// The home is static/ISR, so nothing per-visitor is rendered on the server:
// this client component waits for the shared auth state (a session the browser
// already holds, read with getSession, never created here), renders NOTHING
// until a session is known to exist (anonymous visitors see no change and no
// layout shift), then shows a skeleton while the rows load. Any error, or a
// session with no project and no order, renders nothing. RLS limits every read
// to the caller's own rows; the filters below only keep an admin's view to
// their own work.

const TONE: Record<OrderStatus, string> = {
  confirmed: "bg-sky-100 text-sky-800",
  paid: "bg-indigo-100 text-indigo-800",
  sourcing: "bg-amber-100 text-amber-800",
  shipped: "bg-violet-100 text-violet-800",
  delivered: "bg-emerald-100 text-emerald-800",
  cancelled: "bg-slate-200 text-slate-700",
};

type View = { phase: "none" } | { phase: "loading" } | { phase: "ready"; data: YourWorkData };

type ReorderState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; added: number; unavailable: string[] }
  | { phase: "error" };

function YourWorkStrip() {
  const { ready, user } = useAuth();
  const userId = ready ? (user?.id ?? null) : null;
  const [view, setView] = useState<View>({ phase: "none" });

  useEffect(() => {
    if (!userId) {
      setView({ phase: "none" });
      return;
    }
    let cancelled = false;
    setView({ phase: "loading" });
    loadYourWork(userId).then(
      (data) => {
        if (!cancelled) setView(data ? { phase: "ready", data } : { phase: "none" });
      },
      () => {
        if (!cancelled) setView({ phase: "none" });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (view.phase === "none") return null;
  if (view.phase === "loading") return <StripSkeleton />;
  return <Strip data={view.data} />;
}

function StripSkeleton() {
  return (
    <div aria-hidden className="neu space-y-3 p-4 sm:p-5">
      <Skeleton className="h-3 w-24" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-[4.5rem] rounded-2xl" />
        <Skeleton className="h-[4.5rem] rounded-2xl max-sm:hidden" />
        <Skeleton className="h-[4.5rem] rounded-2xl max-lg:hidden" />
        <Skeleton className="h-[4.5rem] rounded-2xl max-lg:hidden" />
      </div>
    </div>
  );
}

function Strip({ data }: { data: YourWorkData }) {
  const t = useTranslations("YourWork");
  const to = useTranslations("Orders");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const { addItem } = useCart();
  const [reorder, setReorder] = useState<ReorderState>({ phase: "idle" });

  const date = useMemo(
    () =>
      new Intl.DateTimeFormat(intlTag(asLocale(locale)), {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Qatar",
      }),
    [locale]
  );
  const arrow = cn("h-4 w-4 shrink-0", isRtl && "-scale-x-100");

  const { projects, toBuy, lastOrder, lastDelivered } = data;

  async function runReorder() {
    if (!lastDelivered || reorder.phase === "busy") return;
    setReorder({ phase: "busy" });
    try {
      const { lines, parts } = await loadReorderInputs(lastDelivered.id);

      const plan = buildReorderPlan(lines, parts);
      // One at a time: every add re-reads the cart. Plain lines, no kit, no project.
      let added = 0;
      let failed = false;
      for (const l of plan.add) {
        const ok = await addItem({ id: l.part.id, sku: l.part.sku, min_order_qty: l.part.min_order_qty }, l.quantity);
        if (ok) added += 1;
        else failed = true;
      }
      if (failed && added === 0) throw new Error("add failed");
      setReorder({ phase: "done", added, unavailable: plan.unavailable });
    } catch (e) {
      console.error("your-work: reorder failed", e);
      setReorder({ phase: "error" });
    }
  }

  const toBuyLine =
    toBuy.kind === "count" ? (
      <>
        <span className="font-semibold text-heading">{t("toBuyLabel")}:</span>{" "}
        {t("toBuyCount", { count: String(toBuy.count), form: arabicCountForm(toBuy.count) })}
      </>
    ) : toBuy.kind === "none" ? (
      t("toBuyNone")
    ) : projects.length > 0 ? (
      t("toBuyUnknown")
    ) : null;

  const orderStatus = lastOrder ? (normaliseOrderStatus(lastOrder.status) ?? "confirmed") : null;
  const reorderRef = lastDelivered ? orderShort(lastDelivered.id) : null;

  return (
    <section aria-labelledby="your-work-heading" className="neu space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="your-work-heading" className="kicker text-azure">
            {t("kicker")}
          </h2>
          {toBuyLine && <p className="min-w-0 text-xs text-mutedtext">{toBuyLine}</p>}
        </div>
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-cobalt hover:text-cobalt-hover"
        >
          {t("allProjects")}
          <ArrowRight className={arrow} aria-hidden />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
        {projects.map((p) => {
          const name = p.name?.trim() || t("untitled");
          return (
            <Link
              key={p.id}
              href={projectHref(p)}
              aria-label={t("openProjectAria", { name })}
              className="tile flex min-h-11 min-w-0 items-center gap-3 p-4 transition-colors hover:bg-white/60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-heading">{name}</span>
                <span className="block truncate text-xs text-mutedtext">{t("projectLine", { date: date.format(new Date(p.updated_at)) })}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-cobalt">
                {t("openProject")}
                <ChevronRight className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden />
              </span>
            </Link>
          );
        })}

        {lastOrder && orderStatus && (
          <div className="tile flex min-w-0 flex-col gap-2 p-4">
            <Link
              href={`/orders/${lastOrder.id}`}
              aria-label={to("open", { id: orderShort(lastOrder.id) })}
              className="flex min-h-11 min-w-0 items-center gap-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-mutedtext">{t("lastOrder")}</span>
                <span className="block truncate text-sm font-semibold text-heading">{to("orderRef", { id: orderShort(lastOrder.id) })}</span>
              </span>
              <span className={cn("inline-flex shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TONE[orderStatus])}>
                {to(`status_${orderStatus}`)}
              </span>
              <ChevronRight className={cn("h-4 w-4 shrink-0 text-faint", isRtl && "rotate-180")} aria-hidden />
            </Link>

            {lastDelivered && reorderRef && (
              <div className="flex flex-col gap-2 border-t border-border pt-2">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 truncate text-xs text-mutedtext">{t("reorderFrom", { id: reorderRef })}</span>
                  <button
                    type="button"
                    onClick={runReorder}
                    disabled={reorder.phase === "busy"}
                    aria-label={t("reorderAria", { id: reorderRef })}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-cobalt transition-colors hover:bg-white/60 hover:text-cobalt-hover disabled:opacity-60 md:min-h-9"
                  >
                    {reorder.phase === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                    {reorder.phase === "busy" ? t("reordering") : t("reorder")}
                  </button>
                </div>
                <div aria-live="polite" className="space-y-1 text-xs text-body empty:hidden">
                  {reorder.phase === "done" && reorder.added > 0 && (
                    <p className="flex flex-wrap items-center gap-x-3">
                      <span>{t("reordered", { count: String(reorder.added), form: arabicCountForm(reorder.added) })}</span>
                      <Link href="/store/cart" className="inline-flex min-h-11 items-center font-semibold text-cobalt hover:text-cobalt-hover md:min-h-0">
                        {t("viewCart")}
                      </Link>
                    </p>
                  )}
                  {reorder.phase === "done" && reorder.added === 0 && <p>{t("reorderNone")}</p>}
                  {reorder.phase === "done" && reorder.unavailable.length > 0 && (
                    <p>
                      {t("unavailableLabel")} <bdi>{reorder.unavailable.join(", ")}</bdi>
                    </p>
                  )}
                  {reorder.phase === "error" && <p role="alert">{t("reorderError")}</p>}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Default export for the lazy gate (components/home/your-work-gate.tsx). */
export default YourWorkStrip;
