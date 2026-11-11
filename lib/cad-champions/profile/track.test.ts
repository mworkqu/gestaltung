import { describe, expect, it } from "vitest";

import { defaultTrackFor, isCcTrack } from "./track";

describe("track", () => {
  it("preselects from cad_software_used", () => {
    expect(defaultTrackFor("solidworks")).toBe("solidworks");
    expect(defaultTrackFor("fusion")).toBe("fusion");
    expect(defaultTrackFor("inventor")).toBe("inventor");
    expect(defaultTrackFor("other")).toBe("inventor");
    expect(defaultTrackFor("none")).toBe("inventor");
    expect(defaultTrackFor(null)).toBe("inventor");
  });
  it("validates track values", () => {
    expect(isCcTrack("fusion")).toBe(true);
    expect(isCcTrack("catia")).toBe(false);
    expect(isCcTrack(undefined)).toBe(false);
  });
});
