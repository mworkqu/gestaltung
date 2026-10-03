import { describe, expect, it } from "vitest";

import { pickMessages } from "./pick-messages";

const messages = {
  Nav: { store: "Store", design: "Design" },
  Parts: { cartAria: "Cart", addToCart: "Add", deep: { a: "A", b: "B" } },
  Credits: { badge: "{wiring}", other: "x" },
};

describe("pickMessages", () => {
  it("picks whole namespaces", () => {
    expect(pickMessages(messages, ["Nav"])).toEqual({ Nav: messages.Nav });
  });

  it("picks single keys at any depth", () => {
    expect(pickMessages(messages, ["Parts.cartAria", "Parts.deep.b", "Credits.badge"])).toEqual({
      Parts: { cartAria: "Cart", deep: { b: "B" } },
      Credits: { badge: "{wiring}" },
    });
  });

  it("merges a key and its whole namespace into the namespace", () => {
    expect(pickMessages(messages, ["Parts.cartAria", "Parts"])).toEqual({ Parts: messages.Parts });
    expect(pickMessages(messages, ["Parts", "Parts.cartAria"])).toEqual({ Parts: messages.Parts });
  });

  it("ignores unknown entries and leaves the source untouched", () => {
    const before = JSON.stringify(messages);
    expect(pickMessages(messages, ["Nope", "Nav.nope", "Nav.store.deeper"])).toEqual({});
    expect(JSON.stringify(messages)).toBe(before);
  });
});
