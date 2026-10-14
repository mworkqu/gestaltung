import { describe, expect, it } from "vitest";

import { mapAuthError, retryAfterFrom } from "./errors";
import {
  ageOn,
  ccProfileFieldsSchema,
  ccProfileRow,
  ccSignUpSchema,
  checkProfile,
  checkSignUp,
  fieldErrors,
  isMinorDob,
  isProfileComplete,
  metadataProfile,
  qatarToday,
  readMetadataProfile,
} from "./schema";

const NOW = new Date("2026-10-14T10:00:00Z");

function yearsAgo(n: number, dayOffset = 0): string {
  const [y, m, d] = qatarToday().split("-").map(Number);
  const dt = new Date(Date.UTC(y - n, m - 1, d + dayOffset));
  return dt.toISOString().slice(0, 10);
}

const adult = {
  fullName: "Sara Ali",
  phone: "55123478",
  institution: "qu",
  studyLevel: "bachelor",
  dateOfBirth: yearsAgo(20),
  cadSoftwareUsed: "fusion",
  cadExperience: "lt_6m",
  hasWindowsPc: "mac_only",
  marketingConsent: false,
} as const;

describe("dates", () => {
  it("qatarToday uses Asia/Qatar (UTC+3)", () => {
    expect(qatarToday(new Date("2026-10-14T22:30:00Z"))).toBe("2026-10-15");
  });
  it("ageOn counts birthdays", () => {
    expect(ageOn("2008-10-14", NOW)).toBe(18);
    expect(ageOn("2008-10-15", NOW)).toBe(17);
    expect(ageOn("2026-02-30", NOW)).toBeNull();
  });
  it("isMinorDob", () => {
    expect(isMinorDob("2008-10-15", NOW)).toBe(true);
    expect(isMinorDob("2008-10-14", NOW)).toBe(false);
    expect(isMinorDob(null, NOW)).toBe(false);
  });
});

describe("ccProfileFieldsSchema", () => {
  it("accepts an adult and normalises the phone", () => {
    const r = ccProfileFieldsSchema.safeParse(adult);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("+97455123478");
  });
  it("requires guardian fields for a minor", () => {
    const r = ccProfileFieldsSchema.safeParse({ ...adult, dateOfBirth: yearsAgo(16) });
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = fieldErrors(r.error);
      expect(e.guardianName).toBe("guardianName");
      expect(e.guardianPhone).toBe("required");
      expect(e.guardianConsent).toBe("guardianConsent");
    }
    const ok = ccProfileFieldsSchema.safeParse({
      ...adult,
      dateOfBirth: yearsAgo(16),
      guardianName: "Ali",
      guardianPhone: "+974 6612 3478",
      guardianConsent: true,
    });
    expect(ok.success).toBe(true);
  });
  it("rejects bad values with message keys, all at once", () => {
    const r = checkProfile({
      ...adult,
      phone: "123",
      institution: "other",
      studyLevel: "nope",
      dateOfBirth: yearsAgo(-1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors;
      expect(e.phone).toBe("invalidPhone");
      expect(e.studyLevel).toBe("required");
      expect(e.institutionOther).toBe("institutionOther");
      expect(e.dateOfBirth).toBe("dobFuture");
    }
  });
  it("shows guardian errors together with other field errors", () => {
    const r = checkProfile({ ...adult, phone: "1", dateOfBirth: yearsAgo(15) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.phone).toBe("invalidPhone");
      expect(r.errors.guardianConsent).toBe("guardianConsent");
    }
    const s = checkSignUp({ email: "a@b.qa", password: "x", profile: { ...adult, dateOfBirth: yearsAgo(15) } });
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.errors.password).toBe("passwordRules");
      expect(s.errors.guardianName).toBe("guardianName");
    }
  });
  it("rejects an implausible date of birth", () => {
    const r = ccProfileFieldsSchema.safeParse({ ...adult, dateOfBirth: "1800-01-01" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).dateOfBirth).toBe("dobRange");
  });
});

describe("ccSignUpSchema", () => {
  it("checks email and the password rules", () => {
    const bad = ccSignUpSchema.safeParse({ email: "x", password: "abcdefgh", profile: adult });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const e = fieldErrors(bad.error);
      expect(e.email).toBe("invalidEmail");
      expect(e.password).toBe("passwordRules");
    }
    expect(ccSignUpSchema.safeParse({ email: "a@b.qa", password: "abcdefg1", profile: adult }).success).toBe(true);
  });
});

describe("rows and metadata", () => {
  it("ccProfileRow maps columns, track from software, drops guardian for adults", () => {
    const parsed = ccProfileFieldsSchema.parse({ ...adult, guardianName: "x", guardianConsent: true });
    const row = ccProfileRow(parsed, "u1", "A@B.QA", "ar");
    expect(row).toMatchObject({
      id: "u1",
      email: "a@b.qa",
      track_software: "fusion",
      preferred_locale: "ar",
      role: "student",
      guardian_name: null,
      guardian_consent: false,
      institution_other: null,
    });
    expect(isProfileComplete(row)).toBe(true);
    expect(isProfileComplete({ ...row, phone: null })).toBe(false);
  });
  it("track defaults to inventor", () => {
    const parsed = ccProfileFieldsSchema.parse({ ...adult, cadSoftwareUsed: "none" });
    expect(ccProfileRow(parsed, "u1", null, "en").track_software).toBe("inventor");
    const sw = ccProfileFieldsSchema.parse({ ...adult, cadSoftwareUsed: "solidworks" });
    expect(ccProfileRow(sw, "u1", null, "en").track_software).toBe("solidworks");
  });
  it("metadata round-trips", () => {
    const parsed = ccProfileFieldsSchema.parse(adult);
    const back = readMetadataProfile(metadataProfile(parsed, "ar"));
    expect(back?.locale).toBe("ar");
    expect(back?.fields.phone).toBe("+97455123478");
    expect(readMetadataProfile(null)).toBeNull();
    expect(readMetadataProfile({ fullName: "x" })).toBeNull();
  });
});

describe("mapAuthError", () => {
  it("maps Supabase errors to friendly codes", () => {
    expect(mapAuthError({ code: "invalid_credentials", message: "Invalid login credentials" }).code).toBe("invalidCredentials");
    expect(mapAuthError({ code: "email_not_confirmed" }).code).toBe("emailNotConfirmed");
    expect(mapAuthError({ status: 429, message: "For security purposes, you can only request this after 42 seconds." })).toEqual({
      code: "rateLimited",
      retryAfterSec: 42,
    });
    expect(mapAuthError({ code: "over_email_send_rate_limit" }).code).toBe("rateLimited");
    expect(mapAuthError({ code: "user_already_exists" }).code).toBe("userExists");
    expect(mapAuthError({ message: "captcha protection: request disallowed" }).code).toBe("captcha");
    expect(mapAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch" }).code).toBe("network");
    expect(mapAuthError({ message: "boom" }).code).toBe("unknown");
    expect(mapAuthError(null).code).toBe("unknown");
    expect(retryAfterFrom("nothing")).toBeUndefined();
  });
});
