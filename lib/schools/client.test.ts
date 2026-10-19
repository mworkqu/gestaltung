import { describe, expect, it } from "vitest";

import { CLASS_ORDER_PARAM, classOrderIdFrom, withClassOrder } from "./client";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("the class-order marker", () => {
  it("reads an id out of the query string", () => {
    expect(classOrderIdFrom(`?${CLASS_ORDER_PARAM}=${ID}`)).toBe(ID);
    expect(classOrderIdFrom(`?a=1&${CLASS_ORDER_PARAM}=${ID.toUpperCase()}&b=2`)).toBe(ID);
  });

  it("ignores anything that is not an id", () => {
    for (const q of ["", "?", "?class=", "?class=1", "?class=not-an-id", "?other=" + ID, "?class=../../etc"]) {
      expect(classOrderIdFrom(q), q).toBe(null);
    }
  });

  it("keeps the marker on the way to checkout and leaves a normal cart alone", () => {
    expect(withClassOrder("/store/checkout", ID)).toBe(`/store/checkout?${CLASS_ORDER_PARAM}=${ID}`);
    expect(withClassOrder("/store/checkout?x=1", ID)).toBe(`/store/checkout?x=1&${CLASS_ORDER_PARAM}=${ID}`);
    expect(withClassOrder("/store/checkout", null)).toBe("/store/checkout");
  });
});
