// Direct-to-AI project creation (P1-11 / CC-1, 2026-10-08). "Plan a product"
// opens a chat; the project row is created by the first message, not by a
// form. These are the pure pieces of that flow — the client component
// (components/projects/new-project-chat.tsx) does the I/O.
//
// Nothing is inserted before the first send (no empty drafts), and the AI
// consent is stored in the SAME insert as the brief, so the provider never
// receives text before a consent record exists (audit #10).

import { EMPTY_SPEC, type Spec } from "@/lib/prototyping/spec";

/** The placeholder name; /api/projects/name replaces it from the brief. */
export const DEFAULT_PROJECT_NAME = "New project";

export type ChatMsg = { role: "user" | "assistant"; text: string };

/** What the new-project page hands to the workspace chat (sessionStorage). */
export type ChatHandoff = {
  messages: ChatMsg[];
  addition: string | null;
  done: boolean;
  /** The brief-chat error code when the first reply failed; null on success. */
  error: string | null;
};

const STORAGE_PREFIX = "gestaltung:chat:";

/** sessionStorage key for a project's first-turn handoff. */
export function chatStorageKey(projectId: string): string {
  return STORAGE_PREFIX + projectId;
}

/** True when the database refused a 4th active project (trigger from 0042). */
export function isProjectLimitError(message: unknown): boolean {
  return typeof message === "string" && message.includes("project_limit");
}

/** The messages sent to /api/brief-chat for the first turn. */
export function buildFirstTurn(text: string): ChatMsg[] {
  return [{ role: "user", text: text.trim() }];
}

/** The projects insert for the first message: brief + consent in one write. */
export function newProjectInsert({
  userId,
  text,
  destination,
  now,
}: {
  userId: string;
  text: string;
  destination: string;
  now: Date;
}): { user_id: string; name: string; brief: string; spec: Spec } {
  return {
    user_id: userId,
    name: DEFAULT_PROJECT_NAME,
    brief: text.trim(),
    spec: { ...EMPTY_SPEC, aiConsent: { at: now.toISOString(), destination } },
  };
}

/** The handoff written after the first reply (or its failure). */
export function buildHandoff({
  text,
  reply,
  addition,
  done,
  error,
}: {
  text: string;
  reply: string | null;
  addition: string | null;
  done: boolean;
  error: string | null;
}): ChatHandoff {
  return {
    messages: [...buildFirstTurn(text), ...(reply ? [{ role: "assistant" as const, text: reply }] : [])],
    addition: addition || null,
    done,
    error,
  };
}

/** Reads a stored handoff back; anything malformed is ignored (null). */
export function parseHandoff(raw: string | null | undefined): ChatHandoff | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ChatHandoff> | null;
    if (!v || !Array.isArray(v.messages)) return null;
    const messages = v.messages.filter(
      (m): m is ChatMsg =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.length > 0
    );
    if (!messages.length) return null;
    return {
      messages,
      addition: typeof v.addition === "string" && v.addition ? v.addition : null,
      done: v.done === true,
      error: typeof v.error === "string" && v.error ? v.error : null,
    };
  } catch {
    return null;
  }
}
