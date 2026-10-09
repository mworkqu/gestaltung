import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/parts/format";
import { orderShort } from "@/lib/orders/status";
import { OrderStatusPill } from "@/components/orders/order-status-pill";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Orders" });
  return pageMetadata({ locale, path: "/orders", title: t("metaTitle"), description: t("metaDescription"), noindex: true });
}

// Private: per-request session (an account, or a guest's anonymous session
// that placed orders). Never statically cached.
export const dynamic = "force-dynamic";

type Row = { id: string; created_at: string; total_qar: number; status: string };

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/sign-in`);

  const t = await getTranslations("Orders");
  const isRtl = locale === "ar";
  const mono = (extra = "") => cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);
  const date = new Intl.DateTimeFormat(isRtl ? "ar-QA-u-nu-latn" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Qatar",
  });

  // RLS (part_orders_own_select) already limits a customer to their own rows;
  // the profile filter also keeps a super admin's list to their own orders.
  const { data, error } = await supabase
    .from("part_orders")
    .select("id, created_at, total_qar, status")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) console.error(`[orders] list: ${error.message}`);
  const orders = (data ?? []) as Row[];

  return (
    <div className="container max-w-3xl space-y-6 py-8">
      <header className="space-y-2">
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">{t("heading")}</h1>
        <p className="max-w-xl text-base leading-relaxed text-body">{t("intro")}</p>
        {user.is_anonymous && <p className="text-sm text-mutedtext">{t("guestNote")}</p>}
      </header>

      {orders.length === 0 ? (
        <div className="neu space-y-4 p-6">
          <p className="text-body">{t("empty")}</p>
          <Button asChild className="rounded-full">
            <Link href="/store">{t("emptyCta")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="neu divide-y divide-borderstrong/50 p-2">
          {orders.map((o) => {
            const ref = orderShort(o.id);
            return (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}`}
                  aria-label={t("open", { id: ref })}
                  className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-4 py-3 transition-colors hover:bg-panel"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-heading">{t("orderRef", { id: ref })}</p>
                    <p className="text-[13px] text-mutedtext">{date.format(new Date(o.created_at))}</p>
                  </div>
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-heading">
                    {formatPrice(Number(o.total_qar), locale)}
                  </span>
                  <OrderStatusPill status={o.status} />
                  <ChevronRight className={cn("h-4 w-4 shrink-0 text-faint", isRtl && "rotate-180")} aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
