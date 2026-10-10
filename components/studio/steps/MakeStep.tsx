"use client";

// Step 6 · Make it. Two big options:
//  * "Order the parts": every part we sell goes to the cart (quantity 1 /
//    minimum order), then the cart opens;
//  * "Get it made": one lead (POST /api/store-lead, source "studio_quote")
//    with the design name, a link to the project and the part names. The
//    WhatsApp number is asked only when the profile has none (PhonePrompt).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Factory, Loader2, ShoppingCart } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { PhonePrompt } from "@/components/projects/phone-prompt";
import { useStudioLibrary } from "../StudioLibraryProvider";
import { STEP_ACCENT } from "@/lib/studio/palette";
import type { StudioDoc } from "@/lib/studio/schema";
import type { StoreCardPart } from "@/lib/store/catalog";
import type { Profile } from "@/lib/studio/client/api";
import type { StudioCtx } from "../StudioShell";
import { Problem, StepFrame } from "../ui";
import { storeLines, useAddAllToCart } from "../use-studio-cart";

const accent = STEP_ACCENT.make;

function BigOption({
  icon: Icon,
  title,
  text,
  busy,
  onClick,
  primary,
}: {
  icon: typeof Factory;
  title: string;
  text: string;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={
        primary
          ? "group flex w-full items-start gap-4 rounded-[24px] bg-cobalt p-5 text-start text-white shadow-[0_12px_28px_-12px_rgba(14,89,197,0.8)] transition-[transform,background-color] hover:bg-cobalt-hover active:scale-[0.99] disabled:opacity-70 sm:p-6"
          : "group flex w-full items-start gap-4 rounded-[24px] bg-surface p-5 text-start text-heading shadow-neu-sm transition-transform hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-70 sm:p-6"
      }
    >
      <span
        className={primary ? "grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15" : "grid h-12 w-12 shrink-0 place-items-center rounded-2xl"}
        style={primary ? undefined : { background: accent.soft }}
      >
        {busy ? (
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
        ) : (
          <Icon className="h-6 w-6" strokeWidth={1.5} style={primary ? undefined : { color: accent.ink }} aria-hidden />
        )}
      </span>
      <span className="space-y-1">
        <span className="block text-lg font-extrabold tracking-tight">{title}</span>
        <span className={primary ? "block text-sm text-white/85" : "block text-sm text-body"}>{text}</span>
      </span>
    </button>
  );
}

export function MakeStep({ ctx, doc, products }: { ctx: StudioCtx; doc: StudioDoc; products: Map<string, StoreCardPart> }) {
  const { getPart } = useStudioLibrary();
  const t = useTranslations("Studio");
  const router = useRouter();
  const cart = useAddAllToCart(ctx.api.mode === "live" ? ctx.projectId : null);
  const [quote, setQuote] = useState<"idle" | "checking" | "phone" | "sending" | "sent" | "failed">("idle");
  const [profile, setProfile] = useState<Profile | null>(null);

  async function orderParts() {
    const { lines } = storeLines(doc.components, products, getPart);
    const ok = await cart.addAll(lines);
    if (ok) router.push("/store/cart");
  }

  async function send(p: Profile, phone: string) {
    setQuote("sending");
    const items = doc.components
      .filter((c) => !c.auto)
      .map((c) => getPart(c.partId)?.name.en ?? c.label);
    const ok = await ctx.api.requestQuote({
      name: p.fullName || t("defaultContactName"),
      phone,
      items,
      locale: ctx.locale,
      designName: doc.spec.name,
    });
    setQuote(ok ? "sent" : "failed");
  }

  async function getMade() {
    setQuote("checking");
    const p = await ctx.api.profile();
    setProfile(p);
    if (p.phone) await send(p, p.phone);
    else if (p.userId) setQuote("phone");
    else setQuote("failed");
  }

  if (quote === "sent") {
    return (
      <StepFrame step="make" n={ctx.n("make")} title={t("title_make")} headline={t("requestReceived")} intro={t("requestReceivedText")}>
        <div
          className="tile flex items-center gap-3 border-0 p-5 motion-safe:animate-rise"
          style={{ background: accent.soft }}
          role="status"
          data-testid="studio-request-received"
        >
          <CheckCircle2 className="h-8 w-8 shrink-0" style={{ color: accent.ink }} strokeWidth={1.5} aria-hidden />
          <p className="text-base font-semibold text-heading">{t("requestReceivedText")}</p>
        </div>
      </StepFrame>
    );
  }

  return (
    <StepFrame step="make" n={ctx.n("make")} title={t("title_make")} headline={t("headline_make")} intro={t("intro_make")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <BigOption
          icon={Factory}
          title={t("getMade")}
          text={t("getMadeText")}
          busy={quote === "checking" || quote === "sending"}
          onClick={() => void getMade()}
          primary
        />
        <BigOption
          icon={ShoppingCart}
          title={t("orderParts")}
          text={t("orderPartsText")}
          busy={cart.state === "adding"}
          onClick={() => void orderParts()}
        />
      </div>
      {quote === "phone" && profile?.userId && (
        <PhonePrompt
          userId={profile.userId}
          variant="quote"
          onSaved={(phone) => void send(profile, phone)}
          onDismiss={() => setQuote("idle")}
        />
      )}
      {quote === "failed" && <Problem>{t("requestFailed")}</Problem>}
      {cart.state === "failed" && <Problem>{t("cartFailed")}</Problem>}
    </StepFrame>
  );
}
