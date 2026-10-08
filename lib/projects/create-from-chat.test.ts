import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROJECT_NAME,
  buildFirstTurn,
  buildHandoff,
  chatStorageKey,
  isProjectLimitError,
  newProjectInsert,
  parseHandoff,
} from "@/lib/projects/create-from-chat";
import { aiConsentOf, hasAiConsent } from "@/lib/prototyping/spec";

const ID = "11111111-2222-4333-8444-555555555555";

describe("isProjectLimitError", () => {
  it("spots the 0042 trigger error", () => {
    expect(isProjectLimitError('project_limit: you already have 3 active projects')).toBe(true);
    expect(isProjectLimitError("P0001: project_limit")).toBe(true);
  });
  it("is false for anything else", () => {
    expect(isProjectLimitError("network error")).toBe(false);
    expect(isProjectLimitError("")).toBe(false);
    expect(isProjectLimitError(undefined)).toBe(false);
  });
});

describe("newProjectInsert", () => {
  const now = new Date("2026-10-08T09:00:00.000Z");
  const row = newProjectInsert({ userId: "u1", text: "  A plant waterer for my balcony  ", destination: "Google Gemini", now });

  it("names it New project and stores the message as the brief", () => {
    expect(row.name).toBe(DEFAULT_PROJECT_NAME);
    expect(row.name).toBe("New project");
    expect(row.brief).toBe("A plant waterer for my balcony");
    expect(row.user_id).toBe("u1");
  });

  it("records the AI consent in the same insert", () => {
    expect(row.spec.aiConsent).toEqual({ at: "2026-10-08T09:00:00.000Z", destination: "Google Gemini" });
    expect(aiConsentOf(row.spec, "Google Gemini")).not.toBeNull();
    expect(hasAiConsent(row.spec, "Google Gemini")).toBe(true);
    expect(row.spec.rows).toEqual([]);
  });
});

describe("chat handoff", () => {
  it("keys sessionStorage by project", () => {
    expect(chatStorageKey(ID)).toBe(`gestaltung:chat:${ID}`);
  });

  it("first turn is the trimmed user message", () => {
    expect(buildFirstTurn(" hi ")).toEqual([{ role: "user", text: "hi" }]);
  });

  it("round-trips a reply", () => {
    const h = buildHandoff({ text: "A lamp", reply: "Indoors or outdoors?", addition: null, done: false, error: null });
    expect(h.messages).toEqual([
      { role: "user", text: "A lamp" },
      { role: "assistant", text: "Indoors or outdoors?" },
    ]);
    expect(parseHandoff(JSON.stringify(h))).toEqual(h);
  });

  it("keeps the user turn and the error when the reply failed", () => {
    const h = buildHandoff({ text: "A lamp", reply: null, addition: null, done: false, error: "unavailable" });
    expect(h.messages).toHaveLength(1);
    expect(parseHandoff(JSON.stringify(h))?.error).toBe("unavailable");
  });

  it("ignores malformed storage", () => {
    expect(parseHandoff(null)).toBeNull();
    expect(parseHandoff("{")).toBeNull();
    expect(parseHandoff(JSON.stringify({ messages: [{ role: "system", text: "x" }] }))).toBeNull();
  });
});
