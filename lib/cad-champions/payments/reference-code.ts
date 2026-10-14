// Payment reference codes, e.g. "CAD-7K3P" (Prompt 10 Step D). PURE, tested.
// The alphabet leaves out 0/O and 1/I so a student can copy the code into a
// bank app note without mistakes. 32 symbols: one random byte % 32 has no
// bias (256 is a multiple of 32). Uniqueness is guaranteed by the database
// (cc_payments.reference_code unique); the server retries on a clash.

export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REFERENCE_PREFIX = "CAD-";
export const REFERENCE_LENGTH = 4;

const REFERENCE_RE = /^CAD-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,8}$/;

function cryptoBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function generateReferenceCode(length: number = REFERENCE_LENGTH, randomBytes: (n: number) => Uint8Array = cryptoBytes): string {
  const len = Math.min(8, Math.max(4, Math.floor(length)));
  const bytes = randomBytes(len);
  let code = "";
  for (let i = 0; i < len; i++) code += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
  return REFERENCE_PREFIX + code;
}

export function isReferenceCode(value: unknown): value is string {
  return typeof value === "string" && REFERENCE_RE.test(value);
}

/** Upper case, spaces removed, prefix added ("cad 7k3p" / "7K3P" -> "CAD-7K3P"). Null when it can't be a code. */
export function normalizeReferenceCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/\s+/g, "");
  const body = raw.startsWith("CAD-") ? raw.slice(4) : raw.startsWith("CAD") ? raw.slice(3) : raw;
  const code = `${REFERENCE_PREFIX}${body}`;
  return isReferenceCode(code) ? code : null;
}
