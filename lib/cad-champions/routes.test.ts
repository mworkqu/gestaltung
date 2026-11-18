import { describe, expect, it } from "vitest";
import {
  CC_BASE,
  CC_DEFAULT_LOCALE,
  ccPath,
  ccSwitchLocale,
  isCcLocale,
  parseCcPath,
} from "./routes";

describe("cc routes", () => {
  it("constants", () => {
    expect(CC_BASE).toBe("/cad-champions");
    expect(CC_DEFAULT_LOCALE).toBe("en");
  });

  it("isCcLocale", () => {
    expect(isCcLocale("en")).toBe(true);
    expect(isCcLocale("ar")).toBe(true);
    expect(isCcLocale("fr")).toBe(false);
    expect(isCcLocale(undefined)).toBe(false);
  });

  it("ccPath", () => {
    expect(ccPath("ar", "/dashboard")).toBe("/cad-champions/ar/dashboard");
    expect(ccPath("en", "dashboard")).toBe("/cad-champions/en/dashboard");
    expect(ccPath("en")).toBe("/cad-champions/en");
    expect(ccPath("en", "/")).toBe("/cad-champions/en");
  });

  it("parseCcPath", () => {
    expect(parseCcPath("/other")).toBeNull();
    expect(parseCcPath("/cad-championsX")).toBeNull();
    expect(parseCcPath("/cad-champions")).toEqual({ locale: null, rest: "/" });
    expect(parseCcPath("/cad-champions/dashboard")).toEqual({ locale: null, rest: "/dashboard" });
    expect(parseCcPath("/cad-champions/ar")).toEqual({ locale: "ar", rest: "/" });
    expect(parseCcPath("/cad-champions/ar/help/x")).toEqual({ locale: "ar", rest: "/help/x" });
  });

  it("ccSwitchLocale", () => {
    expect(ccSwitchLocale("/cad-champions/en/help", "ar")).toBe("/cad-champions/ar/help");
    expect(ccSwitchLocale("/cad-champions/ar", "en")).toBe("/cad-champions/en");
    expect(ccSwitchLocale("/elsewhere", "en")).toBe("/cad-champions/en");
  });
});
