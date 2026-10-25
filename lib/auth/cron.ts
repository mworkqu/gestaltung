import { timingSafeEqual } from "node:crypto";

/**
 * Cron auth: the Authorization header must be exactly `Bearer <secret>`,
 * compared in constant time. An unset/empty secret never authorizes (the route
 * then refuses to run). Every cron route answers a missing header, a wrong
 * secret and an unset secret identically (401 `{ error: "unauthorized" }`).
 */
export function isAuthorizedCron(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret) return false;
  if (!header) return false;
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  if (want.length !== got.length) return false;
  return timingSafeEqual(want, got);
}
