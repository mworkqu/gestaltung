// Phone normalisation for inbound leads. Every callback we promise happens over
// WhatsApp, and a wa.me link needs bare E.164 digits — so a stored "66567410"
// or "+974 974 66567410" is a number we can't actually call back.
//
// Best-effort by design, matching the lead routes: if we can't confidently read
// a number we keep what the visitor typed rather than mangle or reject it. A
// lead is never lost to formatting.

const QA_DIALLING_CODE = "974";
const QA_SUBSCRIBER_LEN = 8; // Qatar mobiles/landlines are 8 digits, no trunk prefix

/**
 * Normalise a submitted phone number to E.164 (`+97466567410`) where we can.
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

  // `+974 974 66567410` — country code applied twice. Collapse the repeats.
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
