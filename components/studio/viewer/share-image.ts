// Share picture: the WebGL frame (transparent) drawn over an opaque, branded
// background on a 2D canvas: the studio's soft gradient, a faint floor glow,
// the product name and a small "Gestaltung360" wordmark in the bottom corner
// (the start corner: left in English, right in Arabic). No network, no fonts
// fetched: the page's own font stack is used.

export type ShareImageOptions = {
  /** Product name (drawn as given, Arabic is fine). */
  title: string;
  /** Arabic: text right-aligned in the bottom-right corner. */
  rtl?: boolean;
  /** Square edge in px (default 1080). */
  size?: number;
  /** Step accent hex for the little dot before the wordmark. */
  accent?: string;
};

export const SHARE_SIZE = 1080;

function fontStack(): string {
  try {
    const f = getComputedStyle(document.body).fontFamily;
    if (f) return f;
  } catch {
    /* no DOM */
  }
  return "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
}

/** Shrink the font until the text fits maxWidth (or the floor size is reached). */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, start: number, min: number, maxWidth: number, family: string) {
  let px = start;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > min && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

/** Paint the background, then `frame` (a square WebGL render), then the text. */
export function composeShareImage(frame: CanvasImageSource, o: ShareImageOptions): HTMLCanvasElement {
  const S = o.size ?? SHARE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("share image: no 2D context");

  // Soft studio gradient (same tones as the viewer) + a light glow behind the product.
  const g = ctx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, "#f6f8fc");
  g.addColorStop(1, "#e2e8f1");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const glow = ctx.createRadialGradient(S * 0.5, S * 0.46, S * 0.05, S * 0.5, S * 0.46, S * 0.62);
  glow.addColorStop(0, "rgba(255,255,255,0.85)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  // The product, a little above centre so the caption has room.
  const inset = Math.round(S * 0.07);
  ctx.drawImage(frame, inset, inset - Math.round(S * 0.05), S - inset * 2, S - inset * 2);

  // Caption: product name (bold) above the wordmark, in the start corner.
  const family = fontStack();
  const pad = Math.round(S * 0.06);
  const rtl = !!o.rtl;
  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = rtl ? "right" : "left";
  ctx.textBaseline = "alphabetic";
  const x = rtl ? S - pad : pad;
  const maxW = S - pad * 2;

  const brandPx = Math.round(S * 0.026);
  ctx.font = `600 ${brandPx}px ${family}`;
  const brand = "Gestaltung360";
  const brandY = S - pad;
  // Accent dot, then the wordmark (the dot sits on the reading-start side).
  const dotR = Math.round(brandPx * 0.28);
  const dotX = rtl ? x - dotR : x + dotR;
  ctx.fillStyle = o.accent ?? "#0e59c5";
  ctx.beginPath();
  ctx.arc(dotX, brandY - brandPx * 0.34, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5b6577";
  ctx.direction = "ltr"; // the brand is always Latin
  ctx.textAlign = rtl ? "right" : "left";
  ctx.fillText(brand, rtl ? x - dotR * 3 : x + dotR * 3, brandY);

  const title = o.title.trim();
  if (title) {
    ctx.direction = rtl ? "rtl" : "ltr";
    const titlePx = fitFont(ctx, title, 800, Math.round(S * 0.052), Math.round(S * 0.03), maxW, family);
    ctx.fillStyle = "#1c2434";
    ctx.fillText(title, x, brandY - brandPx - Math.round(titlePx * 0.45));
  }
  return canvas;
}

export function canvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("share image: canvas is empty"));
    }, "image/png");
  });
}
