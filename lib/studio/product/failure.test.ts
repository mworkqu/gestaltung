import { describe, expect, it } from "vitest";

import { canRetry, reasonOfDesignReply } from "./failure";

describe("reasonOfDesignReply (F-009)", () => {
  it("tells an offline request from a refusal", () => {
    expect(reasonOfDesignReply(0, 0)).toBe("network");
    expect(reasonOfDesignReply(409, 0)).toBe("setup");
    expect(reasonOfDesignReply(500, 0)).toBe("service");
    expect(reasonOfDesignReply(503, 3)).toBe("service");
  });
  it("blames the pictures when designs came back but none drew", () => {
    expect(reasonOfDesignReply(200, 3)).toBe("pictures");
    expect(reasonOfDesignReply(200, 0)).toBe("service");
  });
  it("offers Retry for everything except a browser that cannot draw", () => {
    expect(canRetry("browser")).toBe(false);
    expect(canRetry("network")).toBe(true);
    expect(canRetry("worker")).toBe(true);
  });
});
