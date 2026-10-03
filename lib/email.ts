// Server-only: send one email through Resend. Returns false (never throws)
// when RESEND_API_KEY is missing or the send fails, so callers degrade.

const RESEND_FROM = process.env.RESEND_FROM || "Gestaltung <onboarding@resend.dev>";
export const OWNER_EMAIL = process.env.STORE_LEAD_EMAIL || "info@gestaltung360.com";

export async function sendEmail(opts: {
  to: string[];
  subject: string;
  html: string;
  /** Plain-text part (optional). */
  text?: string;
  replyTo?: string;
  /** Extra email headers, e.g. { "X-Entity-Ref-ID": id } (optional). */
  headers?: Record<string, string>;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
        ...(opts.headers ? { headers: opts.headers } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
