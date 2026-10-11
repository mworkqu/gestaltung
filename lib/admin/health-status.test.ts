import { describe, expect, it } from "vitest";

import { chargingStatus, cleanupStatus, healthStatus, turnstileStatus } from "./health-status";

const both = { siteKeySet: true, secretSet: true };
const none = { siteKeySet: false, secretSet: false };

describe("turnstileStatus", () => {
  it("off with no keys is off on purpose, not a warning", () => {
    const s = turnstileStatus({ enabled: false, ...none });
    expect(s).toMatchObject({ level: "off", state: "offNoKeys" });
    expect(s.envVars).toEqual(["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]);
  });
  it("off with only one key lists just the missing one, still off", () => {
    const s = turnstileStatus({ enabled: false, siteKeySet: true, secretSet: false });
    expect(s).toMatchObject({ level: "off", state: "offNoKeys", envVars: ["TURNSTILE_SECRET_KEY"] });
  });
  it("off with both keys is off, ready to switch on", () => {
    expect(turnstileStatus({ enabled: false, ...both })).toMatchObject({ level: "off", state: "offKeysReady", envVars: [] });
  });
  it("on with both keys is ok", () => {
    expect(turnstileStatus({ enabled: true, ...both })).toMatchObject({ level: "ok", state: "on", envVars: [] });
  });
  it("on with a missing key needs action and names it", () => {
    expect(turnstileStatus({ enabled: true, siteKeySet: false, secretSet: true })).toMatchObject({
      level: "action",
      state: "onMissingKeys",
      envVars: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY"],
    });
    expect(turnstileStatus({ enabled: true, ...none }).envVars).toHaveLength(2);
  });
});

describe("cleanupStatus", () => {
  it("disabled is off", () => expect(cleanupStatus({ enabled: false, dryRun: false })).toMatchObject({ level: "off", state: "disabled" }));
  it("dry run is off (counting only)", () => expect(cleanupStatus({ enabled: true, dryRun: true })).toMatchObject({ level: "off", state: "dryRun" }));
  it("live is ok", () => expect(cleanupStatus({ enabled: true, dryRun: false })).toMatchObject({ level: "ok", state: "live" }));
});

describe("chargingStatus", () => {
  it("on is ok", () => expect(chargingStatus(true).level).toBe("ok"));
  it("off or missing row is off", () => {
    expect(chargingStatus(false).level).toBe("off");
    expect(chargingStatus(null).level).toBe("off");
  });
});

describe("healthStatus", () => {
  const base = {
    turnstile: { enabled: false, ...none },
    geminiKeySet: true,
    groqKeySet: true,
    cleanup: { enabled: true, dryRun: true },
    charging: false,
  };
  it("returns the five items in order", () => {
    expect(healthStatus(base).map((i) => i.id)).toEqual(["turnstile", "gemini", "groq", "cleanup", "charging"]);
  });
  it("a missing AI key needs action and names the variable", () => {
    const r = healthStatus({ ...base, geminiKeySet: false, groqKeySet: false });
    expect(r[1]).toMatchObject({ level: "action", state: "missing", envVars: ["GEMINI_API_KEY"] });
    expect(r[2]).toMatchObject({ level: "action", state: "missing", envVars: ["GROQ_API_KEY"] });
  });
  it("set keys are ok and carry no env vars", () => {
    const r = healthStatus(base);
    expect(r[1]).toMatchObject({ level: "ok", envVars: [] });
    expect(r[2]).toMatchObject({ level: "ok", envVars: [] });
  });
});
