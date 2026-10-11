"use client";

// "Share picture" (Enclosure + Make): the viewer renders the product to a
// 1080 × 1080 PNG on the branded background (ViewerApi.toSharePNG). Phones
// with the Web Share API get the system sheet (WhatsApp, Instagram …);
// everything else downloads the PNG. "Send on WhatsApp" is a plain wa.me link
// with the name + project link, for when sharing a file is not possible.

import { useState, useSyncExternalStore, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { ImageDown, Loader2, MessageCircle } from "lucide-react";

import type { ViewerApi } from "@/components/studio/viewer/types";
import { downloadBlob } from "@/lib/studio/download";
import { fileSlug } from "@/lib/studio/client/steps";
import type { StudioCtx } from "../StudioShell";
import { linkCls } from "../ui";

/** The project's Studio link (what the WhatsApp text points to). */
export function projectLink(ctx: StudioCtx, origin: string): string {
  return `${origin}/${ctx.locale}/projects/${ctx.projectId}/studio`;
}

const noSubscribe = () => () => undefined;
/** window.location.origin after hydration ("" in the server HTML, so both renders agree). */
function useOrigin(): string {
  return useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
}

export function whatsappHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

type State = "idle" | "making" | "saved" | "failed";

/** What "Share picture" needs: the 3D viewer, or a picture (no 3D engine before the CAD). */
export type ShareSource = Pick<ViewerApi, "toSharePNG">;

/** A share source from a picture already on the page (a design preview or the parts picture). */
export function pictureShareSource(url: string): ShareSource {
  return {
    async toSharePNG(opts) {
      const { canvasToPNG, composeShareImage, SHARE_SIZE } = await import("@/components/studio/viewer/share-image");
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      // Fit the picture into a square frame (contain), then the branded share card.
      const side = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      const sq = document.createElement("canvas");
      sq.width = side;
      sq.height = side;
      const ctx = sq.getContext("2d");
      if (!ctx) throw new Error("share image: no 2D context");
      ctx.drawImage(img, (side - img.naturalWidth) / 2, (side - img.naturalHeight) / 2);
      return canvasToPNG(composeShareImage(sq, { ...opts, size: opts.size ?? SHARE_SIZE }));
    },
  };
}

export function ShareActions({
  ctx,
  viewer,
  accent,
  disabled,
}: {
  ctx: StudioCtx;
  viewer: RefObject<ShareSource | null>;
  accent: string;
  disabled?: boolean;
}) {
  const t = useTranslations("Studio");
  const [state, setState] = useState<State>("idle");
  const name = ctx.projectName;
  const origin = useOrigin();
  const text = t("shareText", { name, link: projectLink(ctx, origin) });

  async function share() {
    const api = viewer.current;
    if (!api || state === "making") return;
    setState("making");
    try {
      const blob = await api.toSharePNG({ title: name, rtl: ctx.locale === "ar", accent });
      const fileName = `${fileSlug(name)}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: name, text });
          setState("idle");
          return;
        } catch (err) {
          // The visitor closed the share sheet: nothing to do.
          if ((err as DOMException)?.name === "AbortError") {
            setState("idle");
            return;
          }
          /* any other failure: fall back to the download */
        }
      }
      downloadBlob(fileName, blob, "image/png");
      setState("saved");
    } catch (err) {
      console.warn("[studio] share picture failed", err);
      setState("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        className={linkCls}
        onClick={() => void share()}
        disabled={disabled || state === "making"}
        data-testid="studio-share-picture"
      >
        {state === "making" ? (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
        ) : (
          <ImageDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        )}
        {state === "making" ? t("shareMaking") : t("sharePicture")}
      </button>
      <a
        href={whatsappHref(text)}
        target="_blank"
        rel="noopener noreferrer"
        className={linkCls}
        data-testid="studio-share-whatsapp"
      >
        <MessageCircle className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        {t("shareWhatsApp")}
      </a>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "saved" ? t("shareSaved") : ""}
      </span>
      {state === "failed" && (
        <p role="alert" className="w-full text-center text-sm font-medium text-destructive sm:text-start">
          {t("shareFailed")}
        </p>
      )}
    </>
  );
}
