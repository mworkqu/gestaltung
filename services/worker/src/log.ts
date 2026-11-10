// One-line JSON logs for the worker (docker logs / Docker Desktop read them).
//
// Never logs a secret, an email address, a phone number or a customer brief:
// fields whose NAME looks sensitive are replaced by "[redacted]", and string
// values are scrubbed of anything that looks like an email, a phone number or
// a bearer token. Messages are short fixed strings chosen by the caller.

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type Logger = (level: LogLevel, msg: string, fields?: LogFields) => void;

const SENSITIVE_KEY = /secret|token|password|passwd|authori[sz]ation|cookie|e-?mail|phone|mobile|whatsapp|brief|prompt|idea|message|address|api[-_]?key|^key$|jwt|iban/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// 8+ digits, optionally with +, spaces or dashes: phone numbers (Qatar numbers are 8 digits).
const PHONE = /\+?\d[\d\s-]{6,}\d/g;
const MAX_STRING = 300;
const MAX_DEPTH = 4;

export function scrubString(s: string): string {
  const out = s.replace(BEARER, "Bearer [redacted]").replace(JWT, "[jwt]").replace(EMAIL, "[email]").replace(PHONE, "[number]");
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…` : out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrubString(value);
  if (value instanceof Error) return { name: value.name, message: scrubString(value.message) };
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function formatLine(level: LogLevel, msg: string, fields: LogFields = {}, now: Date = new Date()): string {
  const safe = redact(fields) as Record<string, unknown>;
  return JSON.stringify({ t: now.toISOString(), level, msg: scrubString(msg), ...safe });
}

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  return (level, msg, fields) => write(formatLine(level, msg, fields));
}
