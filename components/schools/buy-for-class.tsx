"use client";

// "Buy parts for all teams" (3d) and "Request an invoice" (3g).
//
// The cart lines are computed ON THE SERVER by lib/schools/class-parts.ts
// (classPartsPlan: one line per store product, the quantities summed across
// teams and the pack maths applied ONCE) and handed down as props. Nothing is
// priced in the browser.
//
// The existing cart is reused (components/parts/cart-provider.tsx useCart)
// through addAll(), which writes every line in ONE statement on no project and
// in no kit — so a class order can never be half added (the lesson of P5-02).
// It is not a kit: a class order belongs to no single project, and the teacher
// may only READ their teams' projects, so they cannot own a kit on one.
//
// After a successful add the teacher is sent to /store/cart?class=<classId>, so
// the cart and checkout can pass p_class_id to create_part_order (migration
// 0097) and the class order gets Economy delivery at QAR 0. Carrying that
// parameter through lives in the cart and checkout pages, not here.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, ReceiptText, ShoppingCart } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/parts/cart-provider";
import { requestSchoolInvoice, type ClassActionError } from "@/app/[locale]/schools/classes/actions";
import { asLocale } from "@/lib/locale";

/** One cart line, already priced and pack-rounded on the server. */
export type ClassCartRow = {
  /** The store product's row id (cart_items.product_id). */
  productId: string;
  sku: string;
  minOrderQty: number;
  /** Listings to buy for the whole class. */
  packs: number;
};

export function BuyForClass({
  locale,
  classId,
  rows,
  /** Pieces the class needs, for "Added {count} parts to your cart." */
  pieces,
}: {
  locale: string;
  classId: string;
  rows: ClassCartRow[];
  pieces: number;
}) {
  const t = useTranslations("SchoolClasses");
  const router = useRouter();
  const { addAll } = useCart();
  const [pending, start] = useTransition();
  const [state, setState] = useState<"idle" | "added" | "empty" | "failed">("idle");

  const buy = () =>
    start(async () => {
      if (rows.length === 0) {
        setState("empty");
        return;
      }
      setState("idle");
      const ok = await addAll(
        rows.map((row) => ({
          part: { id: row.productId, min_order_qty: row.minOrderQty, sku: row.sku },
          quantity: row.packs,
          bomLines: [],
        })),
      );
      if (!ok) {
        setState("failed");
        return;
      }
      setState("added");
      // The class parameter is what gives the order free Economy delivery.
      router.push(`/${asLocale(locale)}/store/cart?class=${encodeURIComponent(classId)}`);
    });

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        className="w-full rounded-full sm:w-auto"
        onClick={buy}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ShoppingCart className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {t("buyAll")}
      </Button>
      <p className="text-xs leading-relaxed text-mutedtext">{t("buyAllNote")}</p>
      {state === "empty" && <p className="text-sm text-mutedtext">{t("buyAllEmpty")}</p>}
      {state === "failed" && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {t("buyAllFailed")}
        </p>
      )}
      {state === "added" && (
        <p className="flex flex-wrap items-center gap-x-3 text-sm text-heading">
          {t("buyAllAdded", { count: String(pieces) })}
          <Link href="/store/cart" className="font-semibold text-cobalt hover:text-cobalt-hover">
            {t("viewCart")}
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * "Request an invoice": one POST to the existing lead endpoint through the
 * server action, which computes the class name, school, team count and parts
 * total itself. Nothing is ordered.
 */
export function RequestInvoiceButton({ locale, classId }: { locale: string; classId: string }) {
  const t = useTranslations("SchoolClasses");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<"idle" | "sent" | ClassActionError>("idle");

  const send = () =>
    start(async () => {
      setResult("idle");
      const res = await requestSchoolInvoice(locale, classId);
      setResult(res.ok ? "sent" : res.error);
    });

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        variant="secondary"
        className="w-full rounded-full sm:w-auto"
        onClick={send}
        disabled={pending || result === "sent"}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <ReceiptText className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        )}
        {pending ? t("invoiceSending") : t("invoice")}
      </Button>
      <p className="text-xs leading-relaxed text-mutedtext">{t("invoiceNote")}</p>
      {result === "sent" && <p className="text-sm font-semibold text-heading">{t("invoiceSent")}</p>}
      {result !== "idle" && result !== "sent" && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {t(result)}
        </p>
      )}
    </div>
  );
}
