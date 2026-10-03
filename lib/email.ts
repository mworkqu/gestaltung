// Server-only: send one email through Resend. Returns false (never throws)
// when RESEND_API_KEY is missing or the send fails, so callers degrade.

const RESEND_FROM = process.env.RESEND_FROM || "Gestaltung <onboarding@resend.dev>";
export const OWNER_EMAIL = process.env.STORE_LEAD_EMAIL || "info@gestaltung360.com";

export type SendEmailOptions = {
  to: string[];
  subject: string;
  html: string;
  /** Plain-text part (optional). */
  text?: string;
  replyTo?: string;
  /** Extra email headers, e.g. { "X-Entity-Ref-ID": id } (optional). */
  headers?: Record<string, string>;
  /**
   * Resend Idempotency-Key request header (optional): a repeat request with the
   * same key inside Resend's window is not sent again.
   */
  idempotencyKey?: string;
};

/** Like sendEmail, but says why a send failed (for logs / the outbox). */
export async function sendEmailResult(opts: SendEmailOptions): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "no_resend_key" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
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
    if (res.ok) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, error: `resend_${res.status}${body ? `: ${body.slice(0, 300)}` : ""}` };
  } catch (e) {
    return { ok: false, error: `network: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) };
  }
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  return (await sendEmailResult(opts)).ok;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
