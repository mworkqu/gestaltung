// Admin home counts (Prompt 11 Step A) — SERVER ONLY. The CALLER checks the
// role first (the admin layout / page). Head-count queries only, so the page
// stays fast; each card degrades on its own (null = could not count).

import type { Locale } from "@/i18n/routing";

import { loadReviewQueue } from "../drawing/review-server";
import { countContentHealthIssues } from "./health-server";
import { adminDb, isMissingSchema } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/home-server.ts is server-only");

export interface HomeCard {
  count: number | null;
  /** Oldest waiting item (ISO), when the card has one. */
  oldestAt?: string | null;
  /** Oldest waiting time in hours (drawings). */
  oldestHours?: number | null;
}

export interface AdminHome {
  drawings: HomeCard;
  payments: HomeCard;
  questions: HomeCard;
  deletions: HomeCard;
  integrity: HomeCard;
  health: HomeCard;
}

type CountResult = { count: number | null; error: { code?: string; message?: string } | null };

async function counted(label: string, run: () => PromiseLike<CountResult>): Promise<number | null> {
  try {
    const { count, error } = await run();
    if (error) {
      if (!isMissingSchema(error.code)) console.error(`[cc-admin-home] ${label} count failed:`, error.code ?? error.message);
      return null;
    }
    return count ?? 0;
  } catch (e) {
    console.error(`[cc-admin-home] ${label} count failed:`, e instanceof Error ? e.message : "unknown");
    return null;
  }
}

export async function loadAdminHome(locale: Locale, isAdmin: boolean): Promise<AdminHome> {
  const empty: HomeCard = { count: null };
  const db = adminDb();
  if (!db) return { drawings: empty, payments: empty, questions: empty, deletions: empty, integrity: empty, health: empty };
  const head = { count: "exact" as const, head: true };
  const skip = Promise.resolve(null);

  const [queue, questions, payments, paymentsOldest, deletions, integrity, health] = await Promise.all([
    loadReviewQueue(locale).catch(() => null),
    counted("questions", () => db.from("cc_lesson_questions").select("id", head).eq("status", "open")),
    isAdmin ? counted("payments", () => db.from("cc_payments").select("id", head).eq("status", "proof_submitted")) : skip,
    isAdmin
      ? Promise.resolve(
          db
            .from("cc_payments")
            .select("proof_submitted_at,created_at")
            .eq("status", "proof_submitted")
            .order("created_at", { ascending: true })
            .limit(1),
        )
          .then(({ data }) => {
            const r = (data?.[0] ?? null) as { proof_submitted_at: string | null; created_at: string } | null;
            return r ? (r.proof_submitted_at ?? r.created_at) : null;
          })
          .catch(() => null)
      : skip,
    isAdmin ? counted("deletions", () => db.from("cc_deletion_requests").select("id", head).eq("status", "pending")) : skip,
    isAdmin ? counted("integrity", () => db.from("cc_integrity_flags").select("id", head).is("resolved_at", null)) : skip,
    isAdmin ? countContentHealthIssues().catch(() => null) : skip,
  ]);

  const rows = queue && queue.ok ? queue.rows : null;
  const oldestHours = rows && rows.length ? Math.max(...rows.map((r) => r.waitingHours ?? 0)) : null;
  return {
    drawings: { count: rows ? rows.length : null, oldestHours },
    payments: { count: payments, oldestAt: paymentsOldest },
    questions: { count: questions },
    deletions: { count: deletions },
    integrity: { count: integrity },
    health: { count: health },
  };
}
