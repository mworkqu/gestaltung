// Phone normalisation for inbound leads. Every callback we promise happens over
// WhatsApp, and a wa.me link needs bare E.164 digits — so a stored "33664265"
// or "+974 974 33664265" is a number we can't actually call back.
//
// Best-effort by design, matching the lead routes: if we can't confidently read
// a number we keep what the visitor typed rather than mangle or reject it. A
// lead is never lost to formatting.

const QA_DIALLING_CODE = "974";
const QA_SUBSCRIBER_LEN = 8; // Qatar mobiles/landlines are 8 digits, no trunk prefix

/**
 * Normalise a submitted phone number to E.164 (`+97433664265`) where we can.
 *
 * Handles the shapes we've actually seen in the inquiries table: bare local
 * numbers, spaced groups, `00` international prefixes, and a duplicated country
 * code from a form that prepended `+974` to a number that already had it.
 *
 * Returns the trimmed original when the input isn't confidently parseable.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;

  // `00974…` — international access code rather than a `+`.
  if (digits.startsWith("00")) digits = digits.slice(2);

  // `+974 974 33664265` — country code applied twice. Collapse the repeats.
  while (digits.startsWith(QA_DIALLING_CODE.repeat(2))) {
    digits = digits.slice(QA_DIALLING_CODE.length);
  }

  // A bare subscriber number: assume Qatar, which is where our customers are.
  if (digits.length === QA_SUBSCRIBER_LEN) {
    digits = QA_DIALLING_CODE + digits;
  }

  // Only claim E.164 when the result is a plausible Qatar number.
  if (
    digits.startsWith(QA_DIALLING_CODE) &&
    digits.length === QA_DIALLING_CODE.length + QA_SUBSCRIBER_LEN
  ) {
    return `+${digits}`;
  }

  // Foreign numbers: keep the digits but only assert `+` if the visitor did.
  // Anything else we leave exactly as typed for a human to read.
  return trimmed.startsWith("+") ? `+${digits}` : trimmed;
}

/**
 * Bare digits for a wa.me deep link, or null when the number isn't usable.
 * `wa.me` rejects `+`, spaces and short local numbers.
 */
export function toWhatsAppDigits(raw: string): string | null {
  const normalised = normalizePhone(raw);
  if (!normalised.startsWith("+")) return null;
  return normalised.slice(1);
}

/** Qatar mobiles (WhatsApp) start with 3, 5, 6 or 7; landlines (4…) can't take WhatsApp. */
const QA_MOBILE = /^[3567]\d{7}$/;

/**
 * Junk that passes a digit count: every digit the same ("55555555") or a
 * running sequence up or down, wrapping 9→0 ("34567890", "76543210").
 */
export function isObviousFakeNumber(digits: string): boolean {
  if (digits.length < 2) return false;
  if (/^(\d)\1+$/.test(digits)) return true;
  const step = (i: number) => (Number(digits[i + 1]) - Number(digits[i]) + 10) % 10;
  const first = step(0);
  if (first !== 1 && first !== 9) return false;
  for (let i = 1; i < digits.length - 1; i++) if (step(i) !== first) return false;
  return true;
}

/**
 * A number we can actually call back on WhatsApp (W2, 2026-10-11): a Qatar
 * MOBILE (+974 and 8 digits starting 3, 5, 6 or 7 — typed with or without
 * +974 / 00974), never all one digit or a running sequence; or an
 * international number written with + / 00 and 8–15 digits (unchanged).
 * Every form checks this before sending AND /api/store-lead + /api/design-quote
 * refuse anything else (422 invalid_phone), so client and server agree.
 */
export function isValidPhone(raw: string): boolean {
  const n = normalizePhone(raw);
  const qa = /^\+974(\d{8})$/.exec(n);
  if (qa) return QA_MOBILE.test(qa[1]) && !isObviousFakeNumber(qa[1]);
  return /^\+\d{8,15}$/.test(n) && !n.startsWith("+974");
}

/**
 * How a phone number is SHOWN to people (admin cards, emails): Qatar numbers
 * as `+974 XXXX XXXX`. Stored values stay bare E.164 (`+97433664265`) because
 * wa.me and tel: need that; this is display only. A number we can't read as a
 * Qatar number is returned as typed (foreign E.164 keeps its `+digits`).
 * Never throws; null / undefined → "".
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const m = /^\+974(\d{4})(\d{4})$/.exec(normalizePhone(trimmed));
  return m ? `+974 ${m[1]} ${m[2]}` : trimmed;
}
