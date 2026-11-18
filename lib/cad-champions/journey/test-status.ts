// Pure state for the dashboard "Free test" card.

export type TestCardAttempt = {
  status: string; // in_progress | submitted | grading | provisional | graded | expired
  deadline_at?: string | null;
} | null;

export type TestCardState =
  | "unavailable" // the diagnostic test is not published yet
  | "locked" // Get Ready is not done
  | "not_started"
  | "in_progress" // timer running
  | "time_up" // timer reached zero, attempt not closed yet
  | "grading"
  | "ready" // provisional or graded
  | "expired";

export function testCardState(input: {
  testAvailable: boolean;
  attempt: TestCardAttempt;
  /** true when the Get Ready steps (and practice upload) still block the test */
  locked: boolean;
  now?: number;
}): TestCardState {
  const { testAvailable, attempt, locked, now = Date.now() } = input;
  if (attempt) {
    switch (attempt.status) {
      case "in_progress": {
        const end = attempt.deadline_at ? Date.parse(attempt.deadline_at) : NaN;
        return Number.isFinite(end) && end <= now ? "time_up" : "in_progress";
      }
      case "submitted":
      case "grading":
        return "grading";
      case "provisional":
      case "graded":
        return "ready";
      case "expired":
        return "expired";
      default:
        break;
    }
  }
  if (!testAvailable) return "unavailable";
  if (locked) return "locked";
  return "not_started";
}

/** Whole seconds left until `deadlineIso`, never negative. NaN deadline -> 0. */
export function secondsLeft(deadlineIso: string, now: number = Date.now()): number {
  const end = Date.parse(deadlineIso);
  if (!Number.isFinite(end)) return 0;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

/** "1:05:09" or "05:09" with Western digits. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${two(m)}:${two(sec)}`;
}
