// First-party access log for the self-hosted site (Mac mini behind the
// Cloudflare Tunnel). Imported by server.mjs; plain JavaScript because that
// file is run by node directly, with no build step.
//
// WHY AT ALL. GA4 is the only traffic measurement the site has, and it is
// consent-gated and lives in Google's dashboard: a visitor who declines
// cookies is invisible, and nothing of it can reach our own dashboard. Every
// request already passes through this process, so one line per request here is
// complete by construction and costs a string append.
//
// WHAT IS WRITTEN. Path (query string dropped), status, duration, the country
// Cloudflare reported, the referrer's HOST only, a crawler flag, and a visitor
// key. Nothing else: no IP address, no query string, no cookie, no account id,
// no user agent text.
//
// THE VISITOR KEY is sha256(ip + user-agent + salt) cut to 12 characters, where
// the salt is random and replaced every day. Within one day the same browser
// gets the same key, so pages-per-visit can be counted; across days the keys
// are unrelatable, because the salt that made yesterday's is gone. That is a
// deliberate ceiling on what this file can ever be used for: it cannot follow
// one person over time, even by us, even later.
//
// FAILURE. Logging must never affect serving: every call is wrapped, a write
// error is counted and dropped, and a full disk or a missing directory just
// turns logging off.

import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Keep this many days of log files; older ones are deleted. */
const KEEP_DAYS = 45;
/** Flush at most this often, so a busy minute is one write, not a thousand. */
const FLUSH_MS = 2000;
/** Hard cap on the buffer, in case of a burst between flushes. */
const MAX_BUFFER = 2000;

const BOT = /bot|crawl|spider|slurp|bingpreview|headless|curl|wget|python-requests|facebookexternalhit|preview|monitor|pingdom|uptime|lighthouse|gpt|claude|anthropic|perplexity|ccbot/i;

/** `2026-11-23` in Asia/Qatar, so a log day is a day in the shop's own clock. */
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Qatar",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function createAccessLog(options = {}) {
  const dir = options.dir ?? process.env.SITE_ACCESS_LOG_DIR ?? "";
  const disabled = !dir || process.env.SITE_ACCESS_LOG === "off";

  let stream = null;
  let streamDay = "";
  let salt = randomBytes(16).toString("hex");
  let saltDay = "";
  let buffer = [];
  let timer = null;
  let dropped = 0;

  if (!disabled) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return { record: () => {}, close: async () => {}, enabled: false };
    }
  }

  function today() {
    return dayFormat.format(new Date());
  }

  function visitorKey(ip, agent, day) {
    if (day !== saltDay) {
      // A new day: a new salt, and yesterday's is gone for good.
      salt = randomBytes(16).toString("hex");
      saltDay = day;
    }
    if (!ip && !agent) return "";
    return createHash("sha256").update(`${ip}\n${agent}\n${salt}`).digest("hex").slice(0, 12);
  }

  function openFor(day) {
    if (stream && streamDay === day) return stream;
    if (stream) stream.end();
    stream = createWriteStream(join(dir, `access-${day}.log`), { flags: "a" });
    stream.on("error", () => {
      dropped += 1;
      stream = null;
      streamDay = "";
    });
    streamDay = day;
    prune(day);
    return stream;
  }

  function prune(day) {
    try {
      const cutoff = new Date(`${day}T00:00:00Z`).getTime() - KEEP_DAYS * 86_400_000;
      for (const name of readdirSync(dir)) {
        const m = /^access-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
        if (!m) continue;
        if (new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) unlinkSync(join(dir, name));
      }
    } catch {
      // Pruning is housekeeping; a failure must not stop logging.
    }
  }

  function flush() {
    timer = null;
    if (!buffer.length) return;
    const lines = buffer.join("");
    buffer = [];
    try {
      const out = openFor(today());
      if (out) out.write(lines);
    } catch {
      dropped += 1;
    }
  }

  function schedule() {
    if (timer || disabled) return;
    timer = setTimeout(flush, FLUSH_MS);
    // Never hold the process open for a log flush.
    if (typeof timer.unref === "function") timer.unref();
  }

  /**
   * Call once per finished request.
   * `req` and `res` are the plain node objects; `startedAt` is a Date.now().
   */
  function record(req, res, startedAt) {
    if (disabled) return;
    try {
      const rawUrl = req.url ?? "/";
      const q = rawUrl.indexOf("?");
      // The query string can carry a search term, an email in a callback or a
      // token: it is cut here and never written.
      const path = (q === -1 ? rawUrl : rawUrl.slice(0, q)).slice(0, 200);

      const headers = req.headers ?? {};
      const agent = String(headers["user-agent"] ?? "");
      const ip = String(headers["cf-connecting-ip"] ?? headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      const country = String(headers["cf-ipcountry"] ?? "").slice(0, 2).toUpperCase();

      let referrerHost = "";
      const referrer = String(headers["referer"] ?? headers["referrer"] ?? "");
      if (referrer) {
        try {
          referrerHost = new URL(referrer).host.slice(0, 80);
        } catch {
          referrerHost = "";
        }
      }

      const day = today();
      const entry = {
        t: Date.now(),
        p: path,
        s: res.statusCode ?? 0,
        d: Math.max(0, Date.now() - startedAt),
        v: visitorKey(ip, agent, day),
        b: BOT.test(agent) || !agent ? 1 : 0,
        c: country === "XX" ? "" : country,
        r: referrerHost,
      };

      if (buffer.length >= MAX_BUFFER) {
        dropped += 1;
        return;
      }
      buffer.push(`${JSON.stringify(entry)}\n`);
      schedule();
    } catch {
      dropped += 1;
    }
  }

  async function close() {
    if (timer) clearTimeout(timer);
    flush();
    await new Promise((resolve) => {
      if (!stream) return resolve();
      stream.end(resolve);
    });
  }

  return {
    record,
    close,
    enabled: !disabled,
    get droppedCount() {
      return dropped;
    },
  };
}
