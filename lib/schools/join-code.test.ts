import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  TEAM_NAME_MAX,
  isJoinCodeShape,
  isTeamNameValid,
  joinUrl,
  normalizeJoinCode,
  normalizeTeamName,
} from "./join-code";

describe("join code", () => {
  it("uses the same alphabet as migration 0096", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../supabase/migrations/0096_school_classes.sql", import.meta.url)),
      "utf8",
    );
    expect(sql).toContain(`v_alphabet text := '${JOIN_CODE_ALPHABET}'`);
    expect(sql).toContain("^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$");
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[AEIOU01]/);
    expect(JOIN_CODE_LENGTH).toBe(6);
  });

  it("tidies what a student types", () => {
    expect(normalizeJoinCode(" bk7-tq2 ")).toBe("BK7TQ2");
    expect(normalizeJoinCode("bk7 tq2 9")).toBe("BK7TQ2"); // capped at 6
    expect(normalizeJoinCode("BK7TQ2XXXX")).toBe("BK7TQ2");
    expect(normalizeJoinCode("")).toBe("");
  });

  it("knows a code that cannot be right before asking the server", () => {
    expect(isJoinCodeShape("bk7tq2")).toBe(true);
    expect(isJoinCodeShape(" BK7-TQ2 ")).toBe(true);
    expect(isJoinCodeShape("BK7TQ")).toBe(false); // too short
    expect(isJoinCodeShape("BK7TQA")).toBe(false); // vowel
    expect(isJoinCodeShape("BK7TQ0")).toBe(false); // zero
    expect(isJoinCodeShape("BK7TQ1")).toBe(false); // one
  });

  it("tidies a team name and caps it at 40 characters", () => {
    expect(normalizeTeamName("  Team   Falcon ")).toBe("Team Falcon");
    expect(normalizeTeamName("فريق   الصقر")).toBe("فريق الصقر");
    expect(normalizeTeamName("x".repeat(60))).toHaveLength(TEAM_NAME_MAX);
    expect(isTeamNameValid("   ")).toBe(false);
    expect(isTeamNameValid("A")).toBe(true);
    expect(isTeamNameValid("x".repeat(60))).toBe(true); // capped, not refused
  });

  it("builds the Arabic-first link printed on the sheet", () => {
    expect(joinUrl("https://gestaltung360.com", "bk7tq2")).toBe("https://gestaltung360.com/ar/join?code=BK7TQ2");
    expect(joinUrl("https://gestaltung360.com/", "BK7TQ2", "en")).toBe(
      "https://gestaltung360.com/en/join?code=BK7TQ2",
    );
  });
});
